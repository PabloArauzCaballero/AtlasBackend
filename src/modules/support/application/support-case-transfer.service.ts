/**
 * @file Servicio de aplicación: transferir un caso de soporte a otro agente o cola.
 * @business Pasa el caso sin obligar al cliente a repetir su historia: el agente que se va deja un resumen.
 * @system deja el resumen interno, libera la asignación, saca al agente de los canales y abre la nueva asignación.
 */
import { Injectable } from '@nestjs/common';
import { InjectConnection } from '@nestjs/sequelize';
import { Sequelize } from 'sequelize-typescript';
import { SupportAgentRepository } from '../support-agent.repository.js';
import { SupportCatalogRepository } from '../support-catalog.repository.js';
import { SupportCaseRepository } from '../support-case.repository.js';
import { SupportCaseTimelineRepository } from '../support-case-timeline.repository.js';
import type { AssignCaseDto } from '../support-case.schemas.js';
import { toInternalCaseDto } from '../support.mapper.js';
import type { SupportActor } from './support-actor.service.js';
import { SupportActorService } from './support-actor.service.js';
import { SupportCaseMembershipService } from './support-case-membership.service.js';
import { SupportCaseRoutingService } from './support-case-routing.service.js';
import { SupportCaseTransitionService } from './support-case-transition.service.js';

@Injectable()
export class SupportCaseTransferService {
  constructor(
    @InjectConnection() private readonly sequelize: Sequelize,
    private readonly cases: SupportCaseRepository,
    private readonly timeline: SupportCaseTimelineRepository,
    private readonly catalog: SupportCatalogRepository,
    private readonly agents: SupportAgentRepository,
    private readonly membership: SupportCaseMembershipService,
    private readonly transitions: SupportCaseTransitionService,
    private readonly actors: SupportActorService,
    private readonly enrutado: SupportCaseRoutingService,
  ) {}

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
    // Antes de dejar el resumen: la nota se escribe en la conversación del caso.
    await this.actors.assertCanViewCase(input.actor, await this.cases.requireById(input.tenantId, input.caseId), input.tenantId);

    await this.enrutado.leaveHandoverSummary(input.tenantId, input.caseId, input.actor, input.dto.summary);

    const updated = await this.sequelize.transaction(async (transaction) => {
      const supportCase = await this.cases.requireById(input.tenantId, input.caseId, { transaction });
      await this.timeline.releaseLiveAssignment(input.caseId, `transfer: ${input.dto.reason}`, { transaction });
      await this.membership.leaveCaseChannels(
        input.tenantId,
        input.caseId,
        supportCase.currentAssigneeAgentId,
        input.dto.reason,
        transaction,
      );

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
