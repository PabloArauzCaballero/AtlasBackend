/**
 * @file Servicio de aplicación: clasificar, asignar y transferir un caso.
 * @business Da al caso un dueño responsable y una vía de salida cuando quien lo tiene no puede resolverlo.
 * @system asignación con historial y transferencia cálida que no obliga a repetir la historia.
 */
import { ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectConnection } from '@nestjs/sequelize';
import { Transaction } from 'sequelize';
import { Sequelize } from 'sequelize-typescript';
import { SupportAgentRepository } from '../support-agent.repository.js';
import { SupportCatalogRepository } from '../support-catalog.repository.js';
import { SupportCaseRepository } from '../support-case.repository.js';
import { SupportCaseTimelineRepository } from '../support-case-timeline.repository.js';
import type { AssignCaseDto, TriageCaseDto } from '../support-case.schemas.js';
import { derivePriority, mostUrgent } from '../domain/priority-policy.js';
import type { SupportImpact, SupportPriority, SupportUrgency } from '../support.constants.js';
import { toInternalCaseDto } from '../support.mapper.js';
import type { SupportActor } from './support-actor.service.js';
import { SupportActorService } from './support-actor.service.js';
import { SupportAuditService } from './support-audit.service.js';
import { SupportCaseMembershipService } from './support-case-membership.service.js';
import { SupportCaseTransitionService } from './support-case-transition.service.js';
import { SupportChannelRepository } from '../support-channel.repository.js';
import { SupportMessageService } from './support-message.service.js';

@Injectable()
export class SupportCaseWorkflowService {
  constructor(
    @InjectConnection() private readonly sequelize: Sequelize,
    private readonly cases: SupportCaseRepository,
    private readonly timeline: SupportCaseTimelineRepository,
    private readonly catalog: SupportCatalogRepository,
    private readonly agents: SupportAgentRepository,
    private readonly channels: SupportChannelRepository,
    private readonly messages: SupportMessageService,
    private readonly membership: SupportCaseMembershipService,
    private readonly transitions: SupportCaseTransitionService,
    private readonly actors: SupportActorService,
    private readonly audit: SupportAuditService,
  ) {}

  /** Reclasificar. Cambia cola, prioridad y con ellas el trabajo que el caso genera. */
  async triage(input: { tenantId: string; actor: SupportActor; caseId: string; dto: TriageCaseDto }) {
    this.actors.assertIsAgent(input.actor);

    const updated = await this.sequelize.transaction(async (transaction) => {
      const supportCase = await this.cases.requireById(input.tenantId, input.caseId, { transaction });
      const classification = await this.resolveClassification(input.tenantId, supportCase, input.dto, transaction);
      const { category, queue, impact, urgency, caseType, priority } = classification;

      await this.transitions.apply({
        tenantId: input.tenantId,
        caseId: input.caseId,
        actor: input.actor,
        to: supportCase.status === 'NEW' ? 'TRIAGED' : (supportCase.status as never),
        eventType: 'CASE_TRIAGED',
        payload: { reason: input.dto.reason, priority, queueCode: input.dto.queueCode ?? null },
        transaction,
        extra: {
          categoryId: category ? String(category.id) : supportCase.categoryId,
          caseType,
          domain: input.dto.domain ?? supportCase.domain,
          impact,
          urgency,
          priority,
          sensitivity: category?.sensitivity ?? supportCase.sensitivity,
          queueId: queue ? String(queue.id) : supportCase.queueId,
          internalSummary: input.dto.internalSummary ?? supportCase.internalSummary,
          triagedAt: supportCase.triagedAt ?? new Date(),
        },
      });

      return this.cases.requireById(input.tenantId, input.caseId, { transaction });
    });

    await this.audit.record({
      tenantId: input.tenantId,
      actor: input.actor,
      actionCode: 'support.case.triage',
      targetType: 'support_case',
      targetId: input.caseId,
      payload: { reason: input.dto.reason },
    });
    return toInternalCaseDto(updated);
  }

  /**
   * Resuelve la clasificación pedida contra el catálogo, sin escribir nada.
   *
   * La prioridad manual no puede REBAJAR el piso que la matriz calcula para seguridad y fraude: si
   * pudiera, bastaría reclasificar un incidente para que dejara de correr contra su reloj. Por eso
   * se combina con `mostUrgent` en vez de aceptarse tal cual.
   */
  /**
   * El resumen de traspaso, como nota interna dentro de la conversación.
   *
   * Es lo que evita que el cliente tenga que contar otra vez toda su historia al siguiente agente
   * —la experiencia que la gente recuerda como «me pasaron de un lado a otro»—. Va como nota y no
   * como mensaje público: es contexto para el equipo, no una explicación para quien espera.
   */
  private async leaveHandoverSummary(tenantId: string, caseId: string, actor: SupportActor, summary?: string): Promise<void> {
    if (!summary) return;
    const channels = await this.channels.listChannelsForCase(caseId);
    const live = channels.find((channel) => !['CLOSED', 'ABANDONED'].includes(channel.status));
    if (!live) return;

    await this.messages.append({
      tenantId,
      channelId: String(live.id),
      actor,
      clientMessageId: `transfer-${caseId}-${Date.now()}`,
      body: summary,
      messageType: 'INTERNAL_NOTE',
      visibility: 'INTERNAL',
    });
  }

  private async resolveClassification(
    tenantId: string,
    supportCase: { categoryId: string | null; caseType: string; domain: string; impact: string; urgency: string; queueId: string | null },
    dto: TriageCaseDto,
    transaction: Transaction,
  ) {
    const category = dto.categoryCode ? await this.catalog.findCategoryByCode(tenantId, dto.categoryCode, { transaction }) : null;
    if (dto.categoryCode && !category) {
      throw new NotFoundException({ code: 'SUPPORT_CATEGORY_NOT_FOUND', categoryCode: dto.categoryCode });
    }

    const queue = await this.resolveQueue(tenantId, dto.queueCode, category?.defaultQueueId ?? null, transaction);
    const impact = (dto.impact ?? supportCase.impact) as SupportImpact;
    const urgency = (dto.urgency ?? supportCase.urgency) as SupportUrgency;
    const caseType = dto.caseType ?? supportCase.caseType;
    const derived = derivePriority({ impact, urgency, caseType: caseType as never });
    const priority = (dto.priority ? mostUrgent(dto.priority as SupportPriority, derived) : derived) as SupportPriority;

    return { category, queue, impact, urgency, caseType, priority };
  }

  /** La cola pedida a mano gana sobre la que trae la categoría; si no hay ninguna, se conserva la actual. */
  private async resolveQueue(tenantId: string, queueCode: string | undefined, categoryQueueId: string | null, transaction: Transaction) {
    if (queueCode) return this.catalog.requireQueueByCode(tenantId, queueCode, { transaction });
    if (categoryQueueId) return this.catalog.findQueueById(tenantId, String(categoryQueueId), { transaction });
    return null;
  }

  /**
   * Tomar el caso. Un agente sólo puede tomarse a sí mismo; asignar a otro es de supervisores.
   *
   * La distinción evita el patrón clásico de repartirse el trabajo entre pares: cuando cualquiera
   * puede asignar a cualquiera, la cola deja de reflejar quién está realmente trabajando en qué.
   */
  async assign(input: { tenantId: string; actor: SupportActor; caseId: string; dto: AssignCaseDto }) {
    const selfAgentId = this.actors.assertIsAgent(input.actor);
    const targetAgentId = input.dto.agentProfileId ?? selfAgentId;
    if (targetAgentId !== selfAgentId && !input.actor.isSupervisor) {
      throw new ForbiddenException({ code: 'SUPPORT_ASSIGN_REQUIRES_SUPERVISOR' });
    }

    const agent = await this.agents.findById(input.tenantId, targetAgentId);
    if (!agent || !agent.isActive) throw new NotFoundException({ code: 'SUPPORT_AGENT_NOT_FOUND', agentProfileId: targetAgentId });

    const updated = await this.sequelize.transaction(async (transaction) => {
      const supportCase = await this.cases.requireById(input.tenantId, input.caseId, { transaction });
      if (supportCase.currentAssigneeAgentId && String(supportCase.currentAssigneeAgentId) === targetAgentId) {
        throw new ConflictException({ code: 'SUPPORT_CASE_ALREADY_ASSIGNED', agentProfileId: targetAgentId });
      }

      await this.timeline.releaseLiveAssignment(input.caseId, input.dto.reason, { transaction });
      await this.timeline.createAssignment(
        {
          tenantId: input.tenantId,
          caseId: input.caseId,
          assigneeType: 'AGENT',
          assigneeAgentProfileId: targetAgentId,
          assignedAt: new Date(),
          assignmentReason: input.dto.reason,
          assignedByActorId: input.actor.actorId,
          assignmentVersion: 1,
        },
        { transaction },
      );

      await this.transitions.apply({
        tenantId: input.tenantId,
        caseId: input.caseId,
        actor: input.actor,
        to: supportCase.status === 'NEW' || supportCase.status === 'TRIAGED' ? 'ASSIGNED' : (supportCase.status as never),
        eventType: 'CASE_ASSIGNED',
        payload: { agentProfileId: targetAgentId, reason: input.dto.reason },
        transaction,
        extra: { currentAssigneeAgentId: targetAgentId },
      });

      await this.membership.joinCaseChannels(
        {
          tenantId: input.tenantId,
          caseId: input.caseId,
          agentProfileId: targetAgentId,
          agentInternalUserId: String(agent.internalUserId),
          reason: input.dto.reason,
        },
        transaction,
      );

      return this.cases.requireById(input.tenantId, input.caseId, { transaction });
    });

    await this.audit.publish({
      tenantId: input.tenantId,
      eventCode: 'support.case.assigned',
      aggregateType: 'support_case',
      aggregateId: input.caseId,
      payload: { agentProfileId: targetAgentId },
      idempotencyKey: `support-case-assigned-${input.caseId}-${targetAgentId}-${updated.lastEventSequence}`,
    });
    return toInternalCaseDto(updated);
  }

  /**
   * Transferencia CÁLIDA: el agente que se va deja un resumen dentro de la conversación.
   *
   * Sin ese resumen, el cliente tiene que contar otra vez toda su historia al siguiente agente, que
   * es la experiencia que la gente recuerda como «me pasaron de un lado a otro». El resumen entra
   * como nota interna: es contexto para el equipo, no un mensaje para el cliente.
   */
  async transfer(input: { tenantId: string; actor: SupportActor; caseId: string; dto: AssignCaseDto & { summary?: string } }) {
    this.actors.assertIsAgent(input.actor);
    const queue = input.dto.queueCode ? await this.catalog.requireQueueByCode(input.tenantId, input.dto.queueCode) : null;

    await this.leaveHandoverSummary(input.tenantId, input.caseId, input.actor, input.dto.summary);

    const updated = await this.sequelize.transaction(async (transaction) => {
      const supportCase = await this.cases.requireById(input.tenantId, input.caseId, { transaction });
      await this.timeline.releaseLiveAssignment(input.caseId, `transfer: ${input.dto.reason}`, { transaction });
      await this.membership.leaveCaseChannels(input.tenantId, input.caseId, supportCase.currentAssigneeAgentId, input.dto.reason, transaction);

      if (input.dto.agentProfileId) {
        await this.timeline.createAssignment(
          {
            tenantId: input.tenantId,
            caseId: input.caseId,
            assigneeType: 'AGENT',
            assigneeAgentProfileId: input.dto.agentProfileId,
            assignedAt: new Date(),
            assignmentReason: input.dto.reason,
            assignedByActorId: input.actor.actorId,
            assignmentVersion: 1,
          },
          { transaction },
        );
        const target = await this.agents.findById(input.tenantId, input.dto.agentProfileId, { transaction });
        if (target) {
          await this.membership.joinCaseChannels(
            {
              tenantId: input.tenantId,
              caseId: input.caseId,
              agentProfileId: input.dto.agentProfileId,
              agentInternalUserId: String(target.internalUserId),
              reason: input.dto.reason,
            },
            transaction,
          );
        }
      } else if (queue) {
        await this.timeline.createAssignment(
          {
            tenantId: input.tenantId,
            caseId: input.caseId,
            assigneeType: 'TEAM',
            assigneeQueueId: String(queue.id),
            assignedAt: new Date(),
            assignmentReason: input.dto.reason,
            assignedByActorId: input.actor.actorId,
            assignmentVersion: 1,
          },
          { transaction },
        );
      }

      await this.transitions.apply({
        tenantId: input.tenantId,
        caseId: input.caseId,
        actor: input.actor,
        to: input.dto.agentProfileId ? 'ASSIGNED' : 'TRIAGED',
        eventType: 'CASE_TRANSFERRED',
        payload: { reason: input.dto.reason, queueCode: input.dto.queueCode ?? null, agentProfileId: input.dto.agentProfileId ?? null },
        transaction,
        extra: {
          currentAssigneeAgentId: input.dto.agentProfileId ?? null,
          queueId: queue ? String(queue.id) : supportCase.queueId,
          transferCount: supportCase.transferCount + 1,
        },
      });

      return this.cases.requireById(input.tenantId, input.caseId, { transaction });
    });

    return toInternalCaseDto(updated);
  }
}
