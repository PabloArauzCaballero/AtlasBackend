/**
 * @file Servicio de aplicación: auditoría de accesos y publicación de eventos de integración.
 * @business Deja constancia de quién abrió, leyó o exportó un expediente, y avisa al resto de Atlas.
 * @system escribe `audit.operational_audit_logs` y publica al outbox sin romper la operación si falla.
 */
import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { CreationAttributes } from 'sequelize';
import { OperationalAuditLogModel } from '../../../database/models/index.js';
import { redactSensitiveObject } from '../../../common/utils/privacy/redaction.util.js';
import { EventsService } from '../../events/events.service.js';
import type { SupportActor } from './support-actor.service.js';

@Injectable()
export class SupportAuditService {
  private readonly logger = new Logger(SupportAuditService.name);

  constructor(
    @InjectModel(OperationalAuditLogModel) private readonly auditLogs: typeof OperationalAuditLogModel,
    private readonly events: EventsService,
  ) {}

  /**
   * La auditoría es un objeto DISTINTO de la historia del caso, y por eso vive en otra tabla.
   *
   * `support_case_events` cuenta lo que le pasó al expediente; esto cuenta lo que hicieron las
   * personas con el sistema, incluidas las lecturas. Un agente que abre veinte expedientes de
   * clientes que no tiene asignados no genera ni un solo evento de caso —no cambió nada— y sin
   * embargo es exactamente el comportamiento que hay que poder detectar.
   */
  async record(input: {
    tenantId: string;
    actor: SupportActor;
    actionCode: string;
    targetType: string;
    targetId: string | null;
    payload?: Record<string, unknown>;
    reasonCode?: string | null;
  }): Promise<void> {
    try {
      await this.auditLogs.create({
        tenantId: input.tenantId,
        actorType: input.actor.actorType,
        actorInternalUserId: input.actor.isInternal ? input.actor.actorId : null,
        actorPlatformUserId: null,
        actionCode: input.actionCode,
        targetType: input.targetType,
        targetId: input.targetId,
        ipAddress: null,
        userAgent: null,
        payloadJson: redactSensitiveObject({ ...(input.payload ?? {}), reasonCode: input.reasonCode ?? null }) as Record<string, unknown>,
        occurredAt: new Date(),
      } as CreationAttributes<OperationalAuditLogModel>);
    } catch (error) {
      // Una auditoría que no se puede escribir es un problema serio, pero tumbar la atención al
      // cliente por ella lo empeora: se registra el fallo y el flujo continúa.
      this.logger.error(`No se pudo registrar auditoría de soporte (${input.actionCode}): ${String(error)}`);
    }
  }

  /**
   * Publica al outbox DESPUÉS de que la transacción del caso confirmó.
   *
   * `EventsService` no acepta transacción, así que publicar dentro habría escrito el evento aunque
   * el caso terminara sin guardarse — un aviso al cliente sobre algo que no existe. Publicar después
   * abre la otra ventana: que el proceso muera entre el commit y el aviso. Por eso cada evento
   * lleva `idempotencyKey` derivada del objeto, y el barrido que reintenta no duplica nada.
   */
  async publish(input: {
    tenantId: string;
    eventCode: string;
    aggregateType: string;
    aggregateId: string;
    payload: Record<string, unknown>;
    idempotencyKey: string;
    correlationId?: string | null;
  }): Promise<void> {
    try {
      await this.events.publish({
        tenantId: input.tenantId,
        eventCode: input.eventCode,
        aggregateType: input.aggregateType,
        aggregateId: input.aggregateId,
        payload: input.payload,
        idempotencyKey: input.idempotencyKey,
        correlationId: input.correlationId ?? null,
        sourceModule: 'support',
        sourceAction: input.eventCode,
      });
    } catch (error) {
      this.logger.warn(`No se pudo publicar ${input.eventCode} para ${input.aggregateId}: ${String(error)}`);
    }
  }
}
