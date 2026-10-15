/**
 * @file Servicio de aplicación: asignar un caso de soporte a un agente.
 * @business Da al caso un dueño responsable; un agente sólo se toma a sí mismo y asignar a otro es de supervisores.
 * @system libera la asignación vigente, abre la nueva, mueve al agente a los canales del caso y publica el evento.
 */
import { ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectConnection } from '@nestjs/sequelize';
import { Sequelize } from 'sequelize-typescript';
import { SupportAgentRepository } from '../support-agent.repository.js';
import { SupportCaseRepository } from '../support-case.repository.js';
import { SupportCaseTimelineRepository } from '../support-case-timeline.repository.js';
import type { AssignCaseDto } from '../support-case.schemas.js';
import { toInternalCaseDto } from '../support.mapper.js';
import type { SupportActor } from './support-actor.service.js';
import { SupportActorService } from './support-actor.service.js';
import { SupportAuditService } from './support-audit.service.js';
import { SupportCaseMembershipService } from './support-case-membership.service.js';
import { SupportCaseTransitionService } from './support-case-transition.service.js';

@Injectable()
export class SupportCaseAssignmentService {
  constructor(
    @InjectConnection() private readonly sequelize: Sequelize,
    private readonly cases: SupportCaseRepository,
    private readonly timeline: SupportCaseTimelineRepository,
    private readonly agents: SupportAgentRepository,
    private readonly membership: SupportCaseMembershipService,
    private readonly transitions: SupportCaseTransitionService,
    private readonly actors: SupportActorService,
    private readonly audit: SupportAuditService,
  ) {}

  /**
   * Tomar el caso. Un agente sólo puede tomarse a sí mismo; asignar a otro es de supervisores.
   *
   * Un caso `RESTRICTED` no se toma: lo asigna un supervisor. Si bastara pulsar «tomar» para quedar
   * como responsable, la regla de visibilidad se saltaría con la misma petición que la activa.
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
      await this.actors.assertCanViewCase(input.actor, supportCase, input.tenantId);
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
}
