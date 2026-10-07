/**
 * @file Caso de uso: la cola interna de solicitudes del titular — listar, ver y mover de estado.
 * @business Una solicitud de derechos que nadie ve vence el plazo legal de 15 días sin que nadie se entere.
 * @system lista y detalla `data_subject_requests` con plazo calculado y mueve su estado por una máquina explícita, con auditoría.
 */
import { ConflictException, ForbiddenException, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { InjectConnection } from '@nestjs/sequelize';
import { QueryTypes } from 'sequelize';
import { Sequelize } from 'sequelize-typescript';
import { AuthenticatedUser } from '../../common/types/auth.types.js';
import { decryptSecretEnvelope } from '../../common/utils/crypto/envelope-encryption.util.js';
import { containsLikePattern } from '../../common/utils/strings/like-pattern.util.js';
import { CustomerPrivacyRepository } from './customer-privacy.repository.js';
import { MAX_ENGINE_ATTEMPTS } from './application/privacy-request-decision.service.js';
import { allowedTransitions, DATA_SUBJECT_REQUEST_DUE_DAYS, evaluateTransition } from './data-subject-request.state.js';
import type { OperationsPrivacyRequestsQueryDto, PrivacyRequestTransitionDto } from './operations-privacy-requests.schemas.js';
import {
  type FilaDeHistorial,
  type FilaDeSolicitud,
  presentarHistorial,
  presentarSolicitud,
  SQL_CONTEO,
  SQL_HISTORIAL,
  SQL_OPEN_STATUSES,
  SQL_RECEIVED_AT,
  SQL_RESUMEN,
  sqlSolicitudes,
} from './operations-privacy-requests.queries.js';

const DIA_MS = 86_400_000;
/** Una solicitud abierta que lleva más de esto sin opinión del Motor (y sin haberse rendido) se señala. */
const SHADOW_STALE_HOURS = 24;

type ResumenFila = {
  open: string;
  overdue: string;
  shadowCompared?: string;
  shadowAgreed?: string;
  shadowFalseAccept?: string;
  shadowHandedToPerson?: string;
  shadowGaveUp?: string;
  shadowStale?: string;
};

/**
 * La medida de la sombra. `agreement` es sobre las que el Motor decidió ACEPTAR o RECHAZAR y una persona ya cerró;
 * las que el Motor mandó a una persona se cuentan aparte (`handedToPerson`) porque ahí no hay acuerdo que medir.
 * Sin ninguna comparada es `null`, no 100 %: «sin datos» no es «de acuerdo».
 */
export function resumenDeSombra(fila: ResumenFila | undefined) {
  const n = (valor?: string) => Number(valor ?? 0);
  const compared = n(fila?.shadowCompared);
  const agreed = n(fila?.shadowAgreed);
  return {
    compared,
    agreed,
    agreement: compared > 0 ? Math.round((agreed / compared) * 1000) / 1000 : null,
    falseAccept: n(fila?.shadowFalseAccept),
    handedToPerson: n(fila?.shadowHandedToPerson),
    gaveUp: n(fila?.shadowGaveUp),
    stale: n(fila?.shadowStale),
  };
}
const BASE_WHERE = 'd._tenant_id = $tenantId AND COALESCE(d._deleted, false) = false';

/**
 * Atender NO es borrar.
 *
 * `completed` significa que una persona de cumplimiento atendió el pedido (entregó la copia,
 * corrigió el dato, anotó la oposición…) y dejó escrito cómo. El borrado real de datos sigue siendo
 * manual y fuera de esta ruta: la retención legal obliga a conservar KYC, antifraude e historial de
 * crédito (`assessRetentionPolicy`), y un botón que borrara «todo» violaría esa obligación.
 */
@Injectable()
export class OperationsPrivacyRequestsService {
  constructor(
    private readonly privacyRepository: CustomerPrivacyRepository,
    @InjectConnection() private readonly sequelize: Sequelize,
  ) {}

  async list(tenantId: string, query: OperationsPrivacyRequestsQueryDto, now: Date = new Date()) {
    const overdueCutoff = new Date(now.getTime() - DATA_SUBJECT_REQUEST_DUE_DAYS * DIA_MS);
    const bind: Record<string, unknown> = { tenantId };
    const filtros: string[] = [];
    if (query.status) {
      bind.status = query.status;
      filtros.push('d.status = $status');
    }
    if (query.type) {
      bind.type = query.type;
      filtros.push('d.request_type = $type');
    }
    if (query.customerId) {
      bind.customerId = query.customerId;
      filtros.push('d.customer_id = $customerId');
    }
    if (query.q) {
      bind.q = containsLikePattern(query.q.trim());
      filtros.push('(d.request_code ILIKE $q OR cu.customer_code ILIKE $q)');
    }
    if (query.overdue) {
      bind.overdueCutoff = overdueCutoff;
      const vencida = `(d.status IN ${SQL_OPEN_STATUSES} AND ${SQL_RECEIVED_AT} < $overdueCutoff)`;
      filtros.push(query.overdue === 'true' ? vencida : `NOT ${vencida}`);
    }
    const where = [BASE_WHERE, ...filtros].join(' AND ');

    const [filas, totales, resumen] = await Promise.all([
      this.sequelize.query<FilaDeSolicitud>(sqlSolicitudes(where, true), {
        type: QueryTypes.SELECT,
        bind: { ...bind, limit: query.pageSize, offset: (query.page - 1) * query.pageSize },
      }),
      this.sequelize.query<{ total: string }>(SQL_CONTEO(where), { type: QueryTypes.SELECT, bind }),
      this.sequelize.query<ResumenFila>(SQL_RESUMEN, {
        type: QueryTypes.SELECT,
        bind: {
          tenantId,
          overdueCutoff,
          maxEngineAttempts: MAX_ENGINE_ATTEMPTS,
          shadowStaleCutoff: new Date(now.getTime() - SHADOW_STALE_HOURS * 3_600_000),
        },
      }),
    ]);

    const total = Number(totales[0]?.total ?? 0);
    return {
      items: filas.map((fila) => presentarSolicitud(fila, now)),
      meta: { page: query.page, pageSize: query.pageSize, total, totalPages: Math.ceil(total / query.pageSize) },
      summary: {
        open: Number(resumen[0]?.open ?? 0),
        overdue: Number(resumen[0]?.overdue ?? 0),
        dueDays: DATA_SUBJECT_REQUEST_DUE_DAYS,
        shadow: resumenDeSombra(resumen[0]),
      },
    };
  }

  /**
   * El detalle de una solicitud. Si pidió una corrección, el valor propuesto se descifra AQUÍ y sólo para quien está
   * mirando (`reader`), y esa lectura queda en la auditoría: es un dato personal que alguien del equipo acaba de ver.
   */
  async detail(
    tenantId: string,
    requestId: string,
    now: Date = new Date(),
    reader?: { currentUser: AuthenticatedUser; ipAddress: string | null },
  ) {
    const [filas, historial] = await Promise.all([
      this.sequelize.query<FilaDeSolicitud>(sqlSolicitudes(`${BASE_WHERE} AND d._id = $requestId`, false, true), {
        type: QueryTypes.SELECT,
        bind: { tenantId, requestId },
      }),
      this.sequelize.query<FilaDeHistorial>(SQL_HISTORIAL, { type: QueryTypes.SELECT, bind: { tenantId, requestId } }),
    ]);
    const fila = filas[0];
    if (!fila) throw new NotFoundException('DATA_SUBJECT_REQUEST_NOT_FOUND');
    const solicitud = presentarSolicitud(fila, now);
    const proposedValue = await this.revealProposedValue(tenantId, requestId, fila, now, reader);
    return {
      ...solicitud,
      proposedValue,
      allowedTransitions: allowedTransitions(solicitud.status),
      history: historial.map(presentarHistorial),
    };
  }

  /** Descifra el valor propuesto para quien mira y deja constancia. Sin lector identificado, no se revela. */
  private async revealProposedValue(
    tenantId: string,
    requestId: string,
    fila: FilaDeSolicitud,
    now: Date,
    reader?: { currentUser: AuthenticatedUser; ipAddress: string | null },
  ): Promise<string | null> {
    if (!fila.proposedValueEnvelope || !reader) return null;
    const valor = await decryptSecretEnvelope(fila.proposedValueEnvelope).catch(() => null);
    if (valor === null) return null;
    await this.privacyRepository.createAudit(
      {
        tenantId,
        actorType: reader.currentUser.role,
        actorInternalUserId: reader.currentUser.internalUserId ?? null,
        actorPlatformUserId: reader.currentUser.platformUserId ?? null,
        actionCode: 'privacy.data_subject_request.proposed_value_read',
        targetType: 'data_subject_request',
        targetId: requestId,
        ipAddress: reader.ipAddress,
        // Quién lo vio y de qué campo; el valor NO (la auditoría no se cifra).
        payload: { customerId: fila.customerId, field: fila.rectificationField },
        occurredAt: now,
      },
      {},
    );
    return valor;
  }

  /**
   * Mueve la solicitud un paso por la máquina de estados, con la fila bloqueada.
   *
   * Tomarla (`in_progress`) la asigna a quien la toma; cerrarla (`completed`/`rejected`) exige
   * motivo, fecha el cierre y deja a quien cerró como responsable. Cada paso queda en la auditoría
   * con estado anterior, nuevo, motivo y autor: eso es el historial del detalle.
   */
  async transition(input: {
    tenantId: string;
    requestId: string;
    dto: PrivacyRequestTransitionDto;
    currentUser: AuthenticatedUser;
    ipAddress: string | null;
    now?: Date;
  }) {
    const { tenantId, requestId, dto, currentUser, ipAddress } = input;
    const now = input.now ?? new Date();
    const actorId = currentUser.internalUserId;
    if (!actorId) throw new ForbiddenException('Esta operación requiere una sesión interna.');

    await this.sequelize.transaction(async (transaction) => {
      const request = await this.privacyRepository.findDataSubjectRequestForUpdate(tenantId, requestId, { transaction });
      if (!request || request.deleted === true) throw new NotFoundException('DATA_SUBJECT_REQUEST_NOT_FOUND');
      const from = request.status ?? 'received';
      const verdict = evaluateTransition(from, dto.toStatus, dto.reason);
      if (!verdict.ok) {
        if (verdict.code === 'DATA_SUBJECT_REQUEST_REASON_REQUIRED') throw new UnprocessableEntityException(verdict.code);
        throw new ConflictException(verdict.code);
      }
      await this.privacyRepository.updateDataSubjectRequest(
        request,
        {
          status: dto.toStatus,
          handledBy: actorId,
          resolvedAt: verdict.terminal ? now : null,
          resolutionNotes: verdict.terminal ? (dto.reason ?? null) : request.resolutionNotes,
          updatedAt: now,
        },
        { transaction },
      );
      await this.privacyRepository.createAudit(
        {
          tenantId,
          actorType: currentUser.role,
          actorInternalUserId: actorId,
          actorPlatformUserId: currentUser.platformUserId ?? null,
          actionCode: 'privacy.data_subject_request.transition',
          targetType: 'data_subject_request',
          targetId: requestId,
          ipAddress,
          payload: { fromStatus: from, toStatus: dto.toStatus, reason: dto.reason ?? null, customerId: request.customerId },
          occurredAt: now,
        },
        { transaction },
      );
    });

    return this.detail(tenantId, requestId, now, { currentUser, ipAddress });
  }
}
