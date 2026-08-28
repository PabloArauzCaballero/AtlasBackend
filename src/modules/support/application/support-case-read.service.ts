/**
 * @file Servicio de aplicación: consultar expedientes con la vista que corresponde a quien pregunta.
 * @business Un cliente ve su caso en su idioma; el equipo ve además cola, prioridad y SLA.
 * @system separa la LECTURA de la escritura: aquí no hay transiciones, sólo autorización y proyección.
 */
import { Injectable } from '@nestjs/common';
import type { SupportCaseModel } from '../../../database/models/index.js';
import { SupportCaseRepository } from '../support-case.repository.js';
import { SupportCaseTimelineRepository } from '../support-case-timeline.repository.js';
import { SupportChannelRepository } from '../support-channel.repository.js';
import type { ListCasesQueryDto } from '../support-case.schemas.js';
import { toAssignmentDto, toCaseEventDto, toCustomerCaseDto, toInternalCaseDto } from '../support.mapper.js';
import type { SupportActor } from './support-actor.service.js';
import { SupportActorService } from './support-actor.service.js';
import { SupportAuditService } from './support-audit.service.js';

@Injectable()
export class SupportCaseReadService {
  constructor(
    private readonly cases: SupportCaseRepository,
    private readonly timeline: SupportCaseTimelineRepository,
    private readonly channels: SupportChannelRepository,
    private readonly actors: SupportActorService,
    private readonly audit: SupportAuditService,
  ) {}

  /**
   * Detalle del caso.
   *
   * Cada lectura interna se AUDITA. No es burocracia: el acceso por curiosidad a expedientes que no
   * se tienen asignados no deja ninguna otra huella —no cambia nada en el caso— y es exactamente el
   * comportamiento que hay que poder detectar después.
   */
  async getCase(input: { tenantId: string; actor: SupportActor; caseId: string }) {
    const supportCase = await this.cases.requireById(input.tenantId, input.caseId);
    await this.actors.assertCanViewCase(input.actor, supportCase, input.tenantId);

    const channels = await this.channels.listChannelsForCase(input.caseId);
    const base = input.actor.isInternal ? toInternalCaseDto(supportCase) : toCustomerCaseDto(supportCase);

    if (input.actor.isInternal) {
      await this.audit.record({
        tenantId: input.tenantId,
        actor: input.actor,
        actionCode: 'support.case.read',
        targetType: 'support_case',
        targetId: input.caseId,
        payload: { sensitivity: supportCase.sensitivity },
      });
    }

    return {
      ...base,
      channels: channels.map((channel) => ({ channelId: String(channel.id), status: channel.status, type: channel.channelType })),
    };
  }

  /**
   * La historia completa del expediente. Sólo para el equipo.
   *
   * Incluye el hash de cada evento para que una exportación pueda verificarse sin volver a
   * preguntarle al servidor que la produjo.
   */
  async getTimeline(input: { tenantId: string; actor: SupportActor; caseId: string }) {
    const supportCase = await this.cases.requireById(input.tenantId, input.caseId);
    await this.actors.assertCanViewCase(input.actor, supportCase, input.tenantId);
    this.actors.assertIsAgent(input.actor);

    const [events, assignments, clocks, resolution, links, references] = await Promise.all([
      this.cases.listEvents(input.caseId),
      this.timeline.listAssignments(input.caseId),
      this.timeline.listClocks(input.caseId),
      this.timeline.findCurrentResolution(input.caseId),
      this.timeline.listLinks(input.caseId),
      this.timeline.listReferences(input.caseId),
    ]);

    await this.audit.record({
      tenantId: input.tenantId,
      actor: input.actor,
      actionCode: 'support.case.timeline_read',
      targetType: 'support_case',
      targetId: input.caseId,
    });

    return {
      events: events.map(toCaseEventDto),
      assignments: assignments.map(toAssignmentDto),
      sla: clocks.map((clock) => ({
        metric: clock.metricType,
        state: clock.state,
        startedAt: new Date(clock.startedAt).toISOString(),
        targetAt: new Date(clock.targetAt).toISOString(),
        satisfiedAt: clock.satisfiedAt ? new Date(clock.satisfiedAt).toISOString() : null,
        breachedAt: clock.breachedAt ? new Date(clock.breachedAt).toISOString() : null,
        totalPausedSeconds: clock.totalPausedSeconds,
      })),
      resolution: resolution
        ? {
            resolutionCode: resolution.resolutionCode,
            rootCauseCode: resolution.rootCauseCode,
            customerResolution: resolution.customerResolution,
            internalResolution: resolution.internalResolution,
            resolvedAt: new Date(resolution.resolvedAt).toISOString(),
          }
        : null,
      links: links.map((link) => ({
        caseId: String(link.caseId),
        linkedCaseId: String(link.linkedCaseId),
        linkType: link.linkType,
        note: link.note,
      })),
      references: references.map((reference) => ({
        entityType: reference.entityType,
        entityId: reference.entityId,
        relationType: reference.relationType,
        label: reference.snapshotLabel,
      })),
    };
  }

  /** Los casos propios: el filtro por sujeto lo pone el servidor, nunca la petición. */
  async listOwnCases(input: { tenantId: string; actor: SupportActor; query: ListCasesQueryDto; partnerProfileId?: string | null }) {
    const rows = await this.cases.listCases({
      tenantId: input.tenantId,
      customerId: input.actor.actorType === 'CUSTOMER' ? input.actor.customerId : null,
      partnerProfileId: input.actor.actorType === 'PARTNER_USER' ? (input.partnerProfileId ?? null) : null,
      openedByActorId: input.actor.actorType === 'PARTNER_USER' ? input.actor.actorId : null,
      statuses: input.query.status ? input.query.status.split(',') : undefined,
      limit: input.query.limit,
      cursorOpenedAt: input.query.cursorOpenedAt ? new Date(input.query.cursorOpenedAt) : null,
      cursorId: input.query.cursorId ?? null,
    });

    return { cases: rows.map(toCustomerCaseDto), nextCursor: this.nextCursor(rows, input.query.limit) };
  }

  /**
   * La cola de trabajo del equipo.
   *
   * Se ordena por prioridad y antigüedad —no sólo por prioridad— para evitar inanición: sin la
   * antigüedad, un flujo constante de P3 nuevos dejaría los P3 viejos al final para siempre.
   */
  async listWorkQueue(input: { tenantId: string; actor: SupportActor; query: ListCasesQueryDto }) {
    const agentProfileId = this.actors.assertIsAgent(input.actor);
    const rows = await this.cases.listCases({
      tenantId: input.tenantId,
      queueId: input.query.queueId ?? null,
      assigneeAgentId: input.query.assignedToMe ? agentProfileId : null,
      statuses: input.query.status
        ? input.query.status.split(',')
        : ['NEW', 'TRIAGED', 'ASSIGNED', 'IN_PROGRESS', 'WAITING_CUSTOMER', 'WAITING_INTERNAL', 'WAITING_PARTNER', 'ESCALATED'],
      priorities: input.query.priority ? input.query.priority.split(',') : undefined,
      limit: input.query.limit,
      cursorOpenedAt: input.query.cursorOpenedAt ? new Date(input.query.cursorOpenedAt) : null,
      cursorId: input.query.cursorId ?? null,
    });

    const visible = rows.filter((row) => row.sensitivity !== 'RESTRICTED' || input.actor.isSupervisor || String(row.currentAssigneeAgentId) === agentProfileId);
    return { cases: visible.map(toInternalCaseDto), nextCursor: this.nextCursor(rows, input.query.limit) };
  }

  private nextCursor(rows: SupportCaseModel[], limit: number) {
    if (rows.length < limit) return null;
    const last = rows[rows.length - 1];
    return last ? { openedAt: new Date(last.openedAt).toISOString(), id: String(last.id) } : null;
  }
}
