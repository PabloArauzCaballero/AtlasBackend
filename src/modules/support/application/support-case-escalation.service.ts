/**
 * @file Servicio de aplicación: escalar un caso y anotar contexto para el equipo.
 * @business Da salida a lo que un agente no puede resolver y deja constancia de por qué.
 * @system cambia cola y sensibilidad al escalar; las notas y enlaces quedan en la historia del caso.
 */
import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectConnection } from '@nestjs/sequelize';
import { Sequelize } from 'sequelize-typescript';
import { SupportCatalogRepository } from '../support-catalog.repository.js';
import { SupportCaseRepository } from '../support-case.repository.js';
import { SupportCaseTimelineRepository } from '../support-case-timeline.repository.js';
import { SupportChannelRepository } from '../support-channel.repository.js';
import type { EscalateCaseDto, InternalNoteDto, LinkCaseDto } from '../support-case.schemas.js';
import { SUPPORT_QUEUE_CODES } from '../support.constants.js';
import { toInternalCaseDto } from '../support.mapper.js';
import type { SupportActor } from './support-actor.service.js';
import { SupportActorService } from './support-actor.service.js';
import { SupportAuditService } from './support-audit.service.js';
import { SupportCaseTransitionService } from './support-case-transition.service.js';
import { SupportMessageService } from './support-message.service.js';

/**
 * A qué cola manda cada tipo de escalamiento cuando quien escala no nombra una.
 *
 * El valor por defecto importa: obligar a elegir cola al escalar por seguridad haría que quien
 * duda —que es justo quien más debería escalar— no lo haga por no saber a dónde.
 */
const ESCALATION_QUEUES: Readonly<Record<EscalateCaseDto['escalationType'], string>> = {
  FUNCTIONAL: SUPPORT_QUEUE_CODES.CONSUMER_L2,
  HIERARCHICAL: SUPPORT_QUEUE_CODES.CONSUMER_L2,
  SECURITY: SUPPORT_QUEUE_CODES.SECURITY_FRAUD,
  FRAUD: SUPPORT_QUEUE_CODES.SECURITY_FRAUD,
  PRIVACY: SUPPORT_QUEUE_CODES.PRIVACY,
};

@Injectable()
export class SupportCaseEscalationService {
  constructor(
    @InjectConnection() private readonly sequelize: Sequelize,
    private readonly cases: SupportCaseRepository,
    private readonly timeline: SupportCaseTimelineRepository,
    private readonly catalog: SupportCatalogRepository,
    private readonly channels: SupportChannelRepository,
    private readonly messages: SupportMessageService,
    private readonly transitions: SupportCaseTransitionService,
    private readonly actors: SupportActorService,
    private readonly audit: SupportAuditService,
  ) {}

  /**
   * Escalar. Cualquier agente puede activar el flujo de seguridad sin tener que estar seguro.
   *
   * Exigirle a quien atiende que decida si el incidente «es real» antes de escalarlo garantiza que
   * los dudosos no se escalen: nadie quiere ser quien hizo saltar la alarma por nada. El coste de un
   * falso positivo lo absorbe el equipo especializado; el de un falso negativo, el cliente.
   */
  async escalate(input: { tenantId: string; actor: SupportActor; caseId: string; dto: EscalateCaseDto }) {
    this.actors.assertIsAgent(input.actor);
    const queueCode = input.dto.targetQueueCode ?? ESCALATION_QUEUES[input.dto.escalationType];
    const queue = await this.catalog.findQueueByCode(input.tenantId, queueCode);
    const security = input.dto.escalationType === 'SECURITY' || input.dto.escalationType === 'FRAUD';

    const updated = await this.sequelize.transaction(async (transaction) => {
      const supportCase = await this.cases.requireById(input.tenantId, input.caseId, { transaction });
      await this.timeline.releaseLiveAssignment(input.caseId, `escalated: ${input.dto.escalationType}`, { transaction });

      await this.transitions.apply({
        tenantId: input.tenantId,
        caseId: input.caseId,
        actor: input.actor,
        to: 'ESCALATED',
        eventType: 'CASE_ESCALATED',
        payload: {
          escalationType: input.dto.escalationType,
          reason: input.dto.reason,
          targetQueue: queueCode,
          customerNotified: input.dto.notifyCustomer,
        },
        transaction,
        extra: {
          escalationLevel: supportCase.escalationLevel + 1,
          queueId: queue ? String(queue.id) : supportCase.queueId,
          currentAssigneeAgentId: null,
          // Un caso escalado a seguridad deja de ser legible para cualquier agente interno.
          sensitivity: security ? 'RESTRICTED' : supportCase.sensitivity,
          priority: security ? 'P1' : supportCase.priority,
        },
      });

      return this.cases.requireById(input.tenantId, input.caseId, { transaction });
    });

    await this.audit.publish({
      tenantId: input.tenantId,
      eventCode: security ? 'support.security.escalated' : 'support.case.escalated',
      aggregateType: 'support_case',
      aggregateId: input.caseId,
      payload: { escalationType: input.dto.escalationType, level: updated.escalationLevel },
      idempotencyKey: `support-case-escalated-${input.caseId}-${updated.escalationLevel}`,
    });
    return toInternalCaseDto(updated);
  }

  /** Nota interna: comparte transcripción con el mensaje, nunca visibilidad. */
  async addInternalNote(input: { tenantId: string; actor: SupportActor; caseId: string; dto: InternalNoteDto }) {
    this.actors.assertIsAgent(input.actor);
    const channels = await this.channels.listChannelsForCase(input.caseId);
    const target = channels.find((channel) => !['CLOSED', 'ABANDONED'].includes(channel.status)) ?? channels[0];
    if (!target) throw new NotFoundException({ code: 'SUPPORT_CHANNEL_NOT_FOUND', caseId: input.caseId });

    const message = await this.messages.append({
      tenantId: input.tenantId,
      channelId: String(target.id),
      actor: input.actor,
      clientMessageId: `note-${input.caseId}-${Date.now()}`,
      body: input.dto.body,
      messageType: 'INTERNAL_NOTE',
      visibility: 'INTERNAL',
    });

    await this.sequelize.transaction((transaction) =>
      this.cases.appendEvent(
        {
          tenantId: input.tenantId,
          caseId: input.caseId,
          eventType: 'CASE_NOTE_ADDED',
          actorType: input.actor.actorType,
          actorId: input.actor.actorId,
          payload: { messageId: String(message.id) },
        },
        transaction,
      ),
    );

    return { messageId: String(message.id), visibility: 'INTERNAL' };
  }

  /** Enlazar dos expedientes. Agrupar no cierra: cada caso conserva su respuesta y su SLA. */
  async link(input: { tenantId: string; actor: SupportActor; caseId: string; dto: LinkCaseDto }) {
    this.actors.assertIsAgent(input.actor);
    await this.cases.requireById(input.tenantId, input.dto.linkedCaseId);

    await this.sequelize.transaction(async (transaction) => {
      await this.timeline.createLink(
        {
          tenantId: input.tenantId,
          caseId: input.caseId,
          linkedCaseId: input.dto.linkedCaseId,
          linkType: input.dto.linkType,
          note: input.dto.note ?? null,
          createdByActorId: input.actor.actorId,
        },
        { transaction },
      );
      await this.cases.appendEvent(
        {
          tenantId: input.tenantId,
          caseId: input.caseId,
          eventType: 'CASE_LINKED',
          actorType: input.actor.actorType,
          actorId: input.actor.actorId,
          payload: { linkedCaseId: input.dto.linkedCaseId, linkType: input.dto.linkType },
        },
        transaction,
      );
    });

    return { caseId: input.caseId, linkedCaseId: input.dto.linkedCaseId, linkType: input.dto.linkType };
  }
}
