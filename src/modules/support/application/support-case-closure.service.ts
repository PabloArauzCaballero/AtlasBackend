/**
 * @file Servicio de aplicación: resolver, cerrar y reabrir un caso.
 * @business El final del expediente: qué se resolvió y cómo se le comunicó a quien esperaba.
 * @system escribe resolución versionada, cierra relojes y conserva todo al reabrir.
 */
import { ConflictException, ForbiddenException, Injectable } from '@nestjs/common';
import { InjectConnection } from '@nestjs/sequelize';
import { Sequelize } from 'sequelize-typescript';
import { canAutoClose } from '../domain/case-state-machine.js';
import { SupportCaseRepository } from '../support-case.repository.js';
import { SupportCaseTimelineRepository } from '../support-case-timeline.repository.js';
import { SupportChannelRepository } from '../support-channel.repository.js';
import type { CloseCaseDto, ReopenCaseDto, ResolveCaseDto } from '../support-case.schemas.js';
import { SUPPORT_REOPEN_WINDOW_DAYS, type SupportCaseType } from '../support.constants.js';
import { toInternalCaseDto } from '../support.mapper.js';
import type { SupportActor } from './support-actor.service.js';
import { SupportActorService } from './support-actor.service.js';
import { SupportAuditService } from './support-audit.service.js';
import { SupportCaseTransitionService } from './support-case-transition.service.js';
import { SupportMessageService } from './support-message.service.js';
import { SupportSlaService } from './support-sla.service.js';

@Injectable()
export class SupportCaseClosureService {
  constructor(
    @InjectConnection() private readonly sequelize: Sequelize,
    private readonly cases: SupportCaseRepository,
    private readonly timeline: SupportCaseTimelineRepository,
    private readonly channels: SupportChannelRepository,
    private readonly messages: SupportMessageService,
    private readonly transitions: SupportCaseTransitionService,
    private readonly sla: SupportSlaService,
    private readonly actors: SupportActorService,
    private readonly audit: SupportAuditService,
  ) {}

  /**
   * Resolver exige las DOS versiones de la resolución.
   *
   * La del cliente se le envía como mensaje —queda en la transcripción, con fecha, y él puede
   * releerla—; la interna se guarda para el equipo. Un solo campo obligaría a elegir entre ser útil
   * dentro o ser publicable fuera, y siempre gana lo primero: así es como una nota con jerga y
   * datos de terceros acaba en la pantalla de un cliente.
   */
  async resolve(input: { tenantId: string; actor: SupportActor; caseId: string; dto: ResolveCaseDto }) {
    this.actors.assertIsAgent(input.actor);

    const updated = await this.sequelize.transaction(async (transaction) => {
      const sequence = await this.timeline.nextResolutionSequence(input.caseId, { transaction });
      await this.timeline.supersedeResolutions(input.caseId, { transaction });
      await this.timeline.createResolution(
        {
          tenantId: input.tenantId,
          caseId: input.caseId,
          resolutionSequence: sequence,
          resolutionCode: input.dto.resolutionCode,
          rootCauseCode: input.dto.rootCauseCode,
          customerResolution: input.dto.customerResolution,
          internalResolution: input.dto.internalResolution,
          workaroundDescription: input.dto.workaroundDescription ?? null,
          resolvedByAgentId: input.actor.agentProfileId,
          resolvedByActorId: input.actor.actorId,
          resolvedAt: new Date(),
        },
        { transaction },
      );

      await this.transitions.apply({
        tenantId: input.tenantId,
        caseId: input.caseId,
        actor: input.actor,
        to: 'RESOLVED',
        eventType: 'CASE_RESOLVED',
        payload: { resolutionCode: input.dto.resolutionCode, rootCauseCode: input.dto.rootCauseCode, sequence },
        transaction,
        extra: { resolvedAt: new Date(), publicSummary: input.dto.customerResolution, internalSummary: input.dto.internalResolution },
      });

      await this.sla.satisfyClock({ caseId: input.caseId, metricType: 'RESOLUTION', at: new Date(), transaction });
      return this.cases.requireById(input.tenantId, input.caseId, { transaction });
    });

    await this.notifyCustomer(input.tenantId, input.actor, input.caseId, input.dto.customerResolution);
    await this.audit.publish({
      tenantId: input.tenantId,
      eventCode: 'support.case.resolved',
      aggregateType: 'support_case',
      aggregateId: input.caseId,
      payload: { resolutionCode: input.dto.resolutionCode, caseNumber: updated.caseNumber },
      idempotencyKey: `support-case-resolved-${input.caseId}-${updated.lastEventSequence}`,
    });

    return toInternalCaseDto(updated);
  }

  /** La resolución se COMUNICA: un caso resuelto que el cliente no leyó sigue abierto para él. */
  private async notifyCustomer(tenantId: string, actor: SupportActor, caseId: string, text: string): Promise<void> {
    const channels = await this.channels.listChannelsForCase(caseId);
    const live = channels.find((channel) => !['CLOSED', 'ABANDONED'].includes(channel.status)) ?? channels[0];
    if (!live) return;
    await this.messages.append({
      tenantId,
      channelId: String(live.id),
      actor,
      clientMessageId: `resolution-${caseId}-${Date.now()}`,
      body: text,
      messageType: 'CASE_STATUS_UPDATE',
      visibility: 'PUBLIC',
    });
  }

  /**
   * Cerrar.
   *
   * Sólo desde `RESOLVED` con resolución escrita, y nunca sobre un caso con bloqueo legal. Seguridad,
   * fraude, reclamo y privacidad exigen además que cierre una persona: el cierre automático de esos
   * cuatro convertiría el silencio de alguien en la conformidad que la empresa necesitaba.
   */
  async close(input: { tenantId: string; actor: SupportActor; caseId: string; dto: CloseCaseDto; automatic?: boolean }) {
    if (!input.automatic) this.actors.assertIsAgent(input.actor);
    const supportCase = await this.cases.requireById(input.tenantId, input.caseId);

    if (supportCase.legalHold) {
      throw new ForbiddenException({ code: 'SUPPORT_CASE_LEGAL_HOLD', message: 'Un caso con bloqueo legal no puede cerrarse.' });
    }
    const resolution = await this.timeline.findCurrentResolution(input.caseId);
    if (!resolution && supportCase.status !== 'DUPLICATE') {
      throw new ConflictException({ code: 'SUPPORT_CASE_WITHOUT_RESOLUTION', message: 'Documenta la resolución antes de cerrar.' });
    }
    if (
      input.automatic &&
      !canAutoClose({
        status: supportCase.status as never,
        caseType: supportCase.caseType as SupportCaseType,
        legalHold: supportCase.legalHold,
        hasCommunicatedResolution: Boolean(resolution),
      })
    ) {
      throw new ConflictException({ code: 'SUPPORT_CASE_AUTO_CLOSE_FORBIDDEN', caseType: supportCase.caseType });
    }

    const updated = await this.sequelize.transaction(async (transaction) => {
      await this.transitions.apply({
        tenantId: input.tenantId,
        caseId: input.caseId,
        actor: input.actor,
        to: 'CLOSED',
        eventType: 'CASE_CLOSED',
        payload: { reason: input.dto.reason, automatic: Boolean(input.automatic) },
        transaction,
        extra: { closedAt: new Date() },
      });
      await this.sla.satisfyClock({ caseId: input.caseId, metricType: 'CLOSE', at: new Date(), transaction });
      await this.sla.cancelRunningClocks(input.caseId, transaction);
      return this.cases.requireById(input.tenantId, input.caseId, { transaction });
    });

    await this.audit.publish({
      tenantId: input.tenantId,
      eventCode: 'support.case.closed',
      aggregateType: 'support_case',
      aggregateId: input.caseId,
      payload: { caseNumber: updated.caseNumber, reason: input.dto.reason },
      idempotencyKey: `support-case-closed-${input.caseId}-${updated.lastEventSequence}`,
    });
    return toInternalCaseDto(updated);
  }

  /**
   * Reabrir dentro de la ventana; fuera de ella, un caso nuevo enlazado como seguimiento.
   *
   * Reabrir conserva el expediente entero —incluida la resolución anterior, que queda marcada como
   * superada— porque «creímos haberlo resuelto y no era» es información que hay que poder contar.
   * Fuera de la ventana se crea otro caso porque un expediente que se reabre un año después mezcla
   * dos problemas distintos y arruina la medición de ambos.
   */
  async reopen(input: { tenantId: string; actor: SupportActor; caseId: string; dto: ReopenCaseDto }) {
    const supportCase = await this.cases.requireById(input.tenantId, input.caseId);
    await this.actors.assertCanViewCase(input.actor, supportCase, input.tenantId);

    const closedAt = supportCase.closedAt ? new Date(supportCase.closedAt).getTime() : null;
    const windowMs = SUPPORT_REOPEN_WINDOW_DAYS * 86_400_000;
    if (closedAt && Date.now() - closedAt > windowMs) {
      throw new ConflictException({
        code: 'SUPPORT_REOPEN_WINDOW_EXPIRED',
        message: `La ventana de reapertura es de ${SUPPORT_REOPEN_WINDOW_DAYS} días. Abre un caso nuevo enlazado a éste.`,
        caseId: input.caseId,
        windowDays: SUPPORT_REOPEN_WINDOW_DAYS,
      });
    }

    const updated = await this.sequelize.transaction(async (transaction) => {
      await this.transitions.apply({
        tenantId: input.tenantId,
        caseId: input.caseId,
        actor: input.actor,
        to: 'REOPENED',
        eventType: 'CASE_REOPENED',
        payload: { reason: input.dto.reason, previousReopenCount: supportCase.reopenedCount },
        transaction,
        extra: { reopenedCount: supportCase.reopenedCount + 1, closedAt: null, resolvedAt: null },
      });
      return this.cases.requireById(input.tenantId, input.caseId, { transaction });
    });

    await this.audit.publish({
      tenantId: input.tenantId,
      eventCode: 'support.case.reopened',
      aggregateType: 'support_case',
      aggregateId: input.caseId,
      payload: { caseNumber: updated.caseNumber, reopenedCount: updated.reopenedCount },
      idempotencyKey: `support-case-reopened-${input.caseId}-${updated.reopenedCount}`,
    });
    return { caseId: input.caseId, reopenedCount: updated.reopenedCount, status: updated.status };
  }
}
