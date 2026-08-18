/**
 * @file Servicio de aplicación o dominio: ejecuta reglas y coordina dependencias.
 * @business Esta pieza controla quién puede operar el canal del comercio afiliado y deja evidencia de cada alta.
 * @system implementa identidad del comercio, credenciales y ciclo de vida de sus usuarios.
 */
import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/sequelize';
import { Op, col, fn, where } from 'sequelize';
import { Sequelize } from 'sequelize-typescript';
import { MerchantUserModel } from '../../database/models/index.js';
import { AuthRepository } from '../auth/auth.repository.js';
import { MerchantActorRepository } from '../auth/merchant-actor.repository.js';
import { hashPassword, isPasswordStrongEnough } from '../../common/utils/crypto/password.util.js';
import { CreateMerchantUserDto, ListMerchantUsersQueryDto, UpdateMerchantUserStatusDto } from './merchant-identity.schemas.js';
import { MerchantUserProfile, PaginatedMerchantUsers } from './merchant-identity.types.js';

export function toMerchantUserProfile(model: MerchantUserModel): MerchantUserProfile {
  return {
    id: String(model.id),
    email: model.email,
    fullName: model.fullName,
    userCode: model.userCode,
    phone: model.phone,
    role: 'merchant',
    status: model.status,
    mustChangePassword: model.mustChangePassword,
    lastLoginAt: model.lastLoginAt ? new Date(model.lastLoginAt).toISOString() : null,
  };
}

/**
 * Alta y ciclo de vida de las identidades del comercio.
 *
 * El alta la hace SIEMPRE personal interno (permiso `merchant.users.manage`, que hoy tiene el rol
 * `MERCHANT_OPERATIONS`): un comercio no se auto-registra, porque su acceso depende de una relación
 * comercial que se aprueba fuera de este servicio. Lo que este módulo NO hace, a propósito, es
 * decidir a qué comercio pertenece la persona: esa membresía vive en el ERP y es él quien la
 * concede. Aquí sólo existe "esta persona puede autenticarse como comercio".
 */
@Injectable()
export class MerchantUsersService {
  constructor(
    @InjectModel(MerchantUserModel) private readonly merchantUserModel: typeof MerchantUserModel,
    private readonly authRepository: AuthRepository,
    private readonly merchantActorRepository: MerchantActorRepository,
    @InjectConnection() private readonly sequelize: Sequelize,
  ) {}

  /**
   * Crea la identidad y su credencial en la MISMA transacción.
   *
   * Separarlas dejaría identidades sin contraseña —invisibles para el login y difíciles de
   * diagnosticar— cada vez que fallara el segundo paso.
   */
  async createMerchantUser(dto: CreateMerchantUserDto, actor: { tenantId: string; internalUserId: string | null }): Promise<MerchantUserProfile> {
    if (!isPasswordStrongEnough(dto.password)) {
      throw new ConflictException('WEAK_PASSWORD');
    }

    const email = dto.email.trim().toLowerCase();
    const existing = await this.merchantActorRepository.findMerchantUserByEmail(email, actor.tenantId);
    if (existing) {
      throw new ConflictException('MERCHANT_USER_EMAIL_TAKEN');
    }

    const passwordHash = await hashPassword(dto.password);

    return this.sequelize.transaction(async (transaction) => {
      const created = await this.merchantUserModel.create(
        {
          tenantId: actor.tenantId,
          email,
          fullName: dto.fullName,
          phone: dto.phone ?? null,
          userCode: dto.userCode ?? null,
          roleCode: 'merchant',
          // Nace `invited`: existe y puede iniciar sesión sólo cuando alguien lo activa
          // explícitamente. El alta y la habilitación son dos decisiones distintas.
          status: 'invited',
          mustChangePassword: true,
          createdByInternalUserId: actor.internalUserId,
          createdAtValue: new Date(),
        } as never,
        { transaction },
      );

      await this.authRepository.createCredentials(
        {
          tenantId: actor.tenantId,
          actorType: 'merchant_user',
          actorId: String(created.id),
          passwordHash,
        },
        { transaction },
      );

      return toMerchantUserProfile(created);
    });
  }

  async listMerchantUsers(tenantId: string, query: ListMerchantUsersQueryDto): Promise<PaginatedMerchantUsers> {
    const filters: unknown[] = [{ tenantId }, { deleted: { [Op.ne]: true } }];
    if (query.status) filters.push({ status: query.status });
    if (query.email) {
      filters.push(where(fn('lower', fn('btrim', col('email'))), query.email.trim().toLowerCase()));
    }

    const { rows, count } = await this.merchantUserModel.findAndCountAll({
      where: { [Op.and]: filters } as never,
      order: [['_id', 'DESC']],
      limit: query.limit,
      offset: (query.page - 1) * query.limit,
    });

    return { items: rows.map(toMerchantUserProfile), page: query.page, limit: query.limit, total: count };
  }

  async getMerchantUser(tenantId: string, merchantUserId: string): Promise<MerchantUserProfile> {
    return toMerchantUserProfile(await this.requireMerchantUser(tenantId, merchantUserId));
  }

  /**
   * Cambia el estado del acceso. Suspender revoca los tokens vigentes en la siguiente rotación
   * porque el refresh vuelve a leer el estado (`reResolveActorRole`); el access token en curso
   * sobrevive lo que le quede de vigencia, que es la ventana conocida del diseño.
   */
  async updateStatus(
    tenantId: string,
    merchantUserId: string,
    dto: UpdateMerchantUserStatusDto,
    actor: { internalUserId: string | null },
  ): Promise<MerchantUserProfile> {
    const merchantUser = await this.requireMerchantUser(tenantId, merchantUserId);

    await merchantUser.update({
      status: dto.status,
      updatedByInternalUserId: actor.internalUserId,
      updatedAtValue: new Date(),
    } as never);

    return toMerchantUserProfile(merchantUser);
  }

  private async requireMerchantUser(tenantId: string, merchantUserId: string): Promise<MerchantUserModel> {
    const merchantUser = await this.merchantUserModel.findOne({
      where: { id: merchantUserId, tenantId, deleted: { [Op.ne]: true } } as never,
    });
    if (!merchantUser) {
      throw new NotFoundException('MERCHANT_USER_NOT_FOUND');
    }
    return merchantUser;
  }
}
