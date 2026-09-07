/**
 * @file Servicio de aplicación o dominio: ejecuta reglas y coordina dependencias.
 * @business Esta pieza controla quién puede operar el canal del comercio afiliado y deja evidencia de cada alta.
 * @system implementa identidad del comercio, credenciales y ciclo de vida de sus usuarios.
 */
import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { Op, Transaction, col, fn, where } from 'sequelize';
import { MerchantUserProvisioningRequestModel } from '../../database/models/index.js';
import { generateTemporaryPassword } from '../../common/utils/crypto/password.util.js';
import {
  ApproveMerchantUserRequestDto,
  EnqueueMerchantUserRequestDto,
  ListMerchantUserRequestsQueryDto,
  RejectMerchantUserRequestDto,
} from './merchant-identity.schemas.js';
import {
  MerchantUserProvisioningRequest,
  MerchantUserProvisioningResult,
  PaginatedMerchantUserRequests,
} from './merchant-identity.types.js';
import { MerchantUsersService } from './merchant-users.service.js';

export function toProvisioningRequest(model: MerchantUserProvisioningRequestModel): MerchantUserProvisioningRequest {
  return {
    id: String(model.id),
    source: model.source,
    externalReference: model.externalReference,
    accountReference: model.accountReference,
    accountName: model.accountName,
    branchName: model.branchName,
    email: model.email,
    fullName: model.fullName,
    phone: model.phone,
    roleCode: model.roleCode,
    requestedBy: model.requestedBy,
    requestedAt: new Date(model.requestedAt).toISOString(),
    status: model.status,
    merchantUserId: model.merchantUserId ? String(model.merchantUserId) : null,
    decidedAt: model.decidedAt ? new Date(model.decidedAt).toISOString() : null,
    rejectionReason: model.rejectionReason,
  };
}

/**
 * La cola de altas de identidad de comercio.
 *
 * ## La regla que sostiene este servicio
 *
 * **Pedir un acceso y concederlo son dos actos de dos sistemas distintos.** Pide el ERP, que es
 * donde vive la relación comercial —la cuenta B2B, la sucursal, el rol— y donde alguien firmó que
 * esa persona trabaja para ese comercio. Concede el personal interno de Atlas desde el portal, que
 * es quien responde de a quién se le da una credencial. Antes las dos cosas las hacía la misma
 * pantalla tecleando el correo a mano, y por eso el portal era el ORIGEN de un usuario de comercio
 * que en realidad no le pertenecía.
 *
 * ## Lo que NO se puede hacer aquí, a propósito
 *
 * - **Aprobar con datos distintos a los de la petición.** Si el correo está mal, se corrige en el
 *   ERP y se vuelve a encolar. Permitir editarlo al aprobar devolvería el problema original —la
 *   identidad diciendo una cosa y el CRM otra— con el agravante de que la petición quedaría
 *   mintiendo sobre lo que se concedió.
 * - **Fijar la contraseña.** La genera Atlas y se entrega UNA vez, en la respuesta de la
 *   aprobación. Ni el ERP ni la pantalla la eligen.
 */
@Injectable()
export class MerchantUserRequestsService {
  constructor(
    @InjectModel(MerchantUserProvisioningRequestModel)
    private readonly requestModel: typeof MerchantUserProvisioningRequestModel,
    private readonly merchantUsersService: MerchantUsersService,
  ) {}

  /**
   * El ERP encola (o corrige) una petición.
   *
   * Es idempotente por `externalReference` porque el reintento es el caso NORMAL, no el raro: el
   * ERP escribe su fila y llama aquí, y si la red se corta entre las dos cosas volverá a llamar con
   * la misma referencia. Sin idempotencia el operador vería la misma alta duplicada y no sabría
   * cuál atender.
   *
   * Una petición ya `provisioned` no se reabre: se devuelve tal cual. Reabrirla pediría una SEGUNDA
   * identidad para alguien que ya la tiene, y el alta moriría contra el índice único del correo con
   * un 409 que no explica nada. Una `rejected` sí vuelve a `pending`: es justo el camino de
   * «corrige y vuelve a pedirlo».
   */
  async enqueue(
    dto: EnqueueMerchantUserRequestDto,
    actor: { tenantId: string; requestedBy: string | null },
  ): Promise<MerchantUserProvisioningRequest> {
    const email = dto.email.trim().toLowerCase();
    const existing = await this.requestModel.findOne({
      where: {
        tenantId: actor.tenantId,
        source: 'erp',
        externalReference: dto.externalReference,
      } as never,
    });

    if (existing && existing.status === 'provisioned') {
      return toProvisioningRequest(existing);
    }

    const campos = {
      accountReference: dto.accountReference ?? null,
      accountName: dto.accountName ?? null,
      branchName: dto.branchName ?? null,
      email,
      fullName: dto.fullName,
      phone: dto.phone ?? null,
      roleCode: dto.roleCode ?? null,
      requestedBy: dto.requestedBy ?? actor.requestedBy,
      status: 'pending',
      // La petición vuelve a estar limpia: sin esto el CHECK de resolución rechaza el UPDATE,
      // porque una fila `pending` no puede conservar el motivo del rechazo anterior.
      rejectionReason: null,
      decidedAt: null,
      decidedByInternalUserId: null,
      updatedAtValue: new Date(),
    };

    if (existing) {
      await existing.update(campos as never);
      return toProvisioningRequest(existing);
    }

    await this.assertNoPendingForEmail(actor.tenantId, email);

    const created = await this.requestModel.create({
      tenantId: actor.tenantId,
      source: 'erp',
      externalReference: dto.externalReference,
      requestedAt: new Date(),
      createdAtValue: new Date(),
      ...campos,
    } as never);

    return toProvisioningRequest(created);
  }

  async list(tenantId: string, query: ListMerchantUserRequestsQueryDto): Promise<PaginatedMerchantUserRequests> {
    const filters: unknown[] = [{ tenantId }];
    if (query.status) filters.push({ status: query.status });
    if (query.email) {
      filters.push(where(fn('lower', fn('btrim', col('email'))), query.email.trim().toLowerCase()));
    }

    const { rows, count } = await this.requestModel.findAndCountAll({
      where: { [Op.and]: filters } as never,
      // Las pendientes primero y, dentro, la más antigua arriba: una cola se atiende por orden de
      // llegada, y ordenar sólo por fecha descendente enterraba la que más lleva esperando.
      order: [
        [col('status'), 'ASC'],
        [col('requested_at'), 'ASC'],
      ] as never,
      limit: query.limit,
      offset: (query.page - 1) * query.limit,
    });

    return { items: rows.map(toProvisioningRequest), page: query.page, limit: query.limit, total: count };
  }

  async get(tenantId: string, requestId: string): Promise<MerchantUserProvisioningRequest> {
    return toProvisioningRequest(await this.requireRequest(tenantId, requestId));
  }

  /**
   * Conceder el acceso: crea la identidad CON LOS DATOS DE LA PETICIÓN y cierra la petición.
   *
   * Las dos escrituras van en la MISMA transacción. Separadas, un fallo al cerrar la petición
   * dejaría la identidad creada y la petición pendiente: el siguiente operador la aprobaría otra
   * vez y chocaría contra el correo ya tomado, con la identidad buena ya existiendo y nadie
   * sabiéndolo.
   *
   * La contraseña provisional se devuelve UNA sola vez. No se guarda en claro ni se puede volver a
   * consultar: para reemplazarla está el restablecimiento, no una segunda lectura.
   */
  async approve(
    tenantId: string,
    requestId: string,
    dto: ApproveMerchantUserRequestDto,
    actor: { internalUserId: string | null },
  ): Promise<MerchantUserProvisioningResult> {
    const temporaryPassword = generateTemporaryPassword();

    return this.merchantUsersService.connection.transaction(async (transaction) => {
      const request = await this.requireRequest(tenantId, requestId, transaction);
      this.assertPending(request);

      const merchantUser = await this.merchantUsersService.createIdentity(
        {
          email: request.email,
          fullName: request.fullName,
          phone: request.phone,
          userCode: dto.userCode ?? null,
          password: temporaryPassword,
        },
        { tenantId, internalUserId: actor.internalUserId },
        transaction,
      );

      await request.update(
        {
          status: 'provisioned',
          merchantUserId: merchantUser.id,
          decidedAt: new Date(),
          decidedByInternalUserId: actor.internalUserId,
          updatedAtValue: new Date(),
        } as never,
        { transaction },
      );

      return { request: toProvisioningRequest(request), merchantUser, temporaryPassword };
    });
  }

  async reject(
    tenantId: string,
    requestId: string,
    dto: RejectMerchantUserRequestDto,
    actor: { internalUserId: string | null },
  ): Promise<MerchantUserProvisioningRequest> {
    const request = await this.requireRequest(tenantId, requestId);
    this.assertPending(request);

    await request.update({
      status: 'rejected',
      rejectionReason: dto.reason,
      decidedAt: new Date(),
      decidedByInternalUserId: actor.internalUserId,
      updatedAtValue: new Date(),
    } as never);

    return toProvisioningRequest(request);
  }

  /**
   * Se comprueba ANTES de insertar y además existe el índice único parcial.
   *
   * El índice es la garantía y esta comprobación es el mensaje: sin ella el ERP recibiría un error
   * de restricción de base de datos, que no le dice a nadie que ya hay una petición esperando por
   * esa misma persona.
   */
  private async assertNoPendingForEmail(tenantId: string, email: string): Promise<void> {
    const pending = await this.requestModel.findOne({
      where: {
        [Op.and]: [{ tenantId }, { status: 'pending' }, where(fn('lower', fn('btrim', col('email'))), email)],
      } as never,
    });
    if (pending) {
      throw new ConflictException('MERCHANT_PROVISIONING_REQUEST_PENDING_FOR_EMAIL');
    }
  }

  private assertPending(request: MerchantUserProvisioningRequestModel): void {
    if (request.status !== 'pending') {
      throw new ConflictException('MERCHANT_PROVISIONING_REQUEST_ALREADY_DECIDED');
    }
  }

  /**
   * Con transacción se pide además el CERROJO de la fila.
   *
   * Dos operadores mirando la misma cola y aprobando a la vez leerían las dos `pending`, y la
   * segunda transacción crearía una identidad duplicada que sólo el índice único del correo
   * frenaría —con un 409 que habla de un correo tomado y no de una carrera—. Con `lock` la segunda
   * espera, vuelve a leer `provisioned` y falla por donde debe: `ALREADY_DECIDED`.
   */
  private async requireRequest(
    tenantId: string,
    requestId: string,
    transaction?: Transaction,
  ): Promise<MerchantUserProvisioningRequestModel> {
    const request = await this.requestModel.findOne({
      where: { id: requestId, tenantId } as never,
      ...(transaction ? { transaction, lock: transaction.LOCK.UPDATE } : {}),
    });
    if (!request) {
      throw new NotFoundException('MERCHANT_PROVISIONING_REQUEST_NOT_FOUND');
    }
    return request;
  }
}
