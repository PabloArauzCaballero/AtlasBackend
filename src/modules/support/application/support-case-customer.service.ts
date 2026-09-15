/**
 * @file Servicio de aplicación: lo que el solicitante puede hacer sobre su propio caso.
 * @business Pedir el cierre, pedir la reapertura y valorar la atención recibida.
 * @system registra la petición como evento; sólo el cierre de un caso ya resuelto es inmediato.
 */
import { ConflictException, Injectable } from '@nestjs/common';
import { InjectConnection } from '@nestjs/sequelize';
import { Sequelize } from 'sequelize-typescript';
import { SupportCaseRepository } from '../support-case.repository.js';
import { SupportCaseTimelineRepository } from '../support-case-timeline.repository.js';
import type { CaseFeedbackDto } from '../support-case.schemas.js';
import { NEVER_AUTO_CLOSE_CASE_TYPES, type SupportCaseType } from '../support.constants.js';
import type { SupportActor } from './support-actor.service.js';
import { SupportActorService } from './support-actor.service.js';
import { SupportCaseClosureService } from './support-case-closure.service.js';

@Injectable()
export class SupportCaseCustomerService {
  constructor(
    @InjectConnection() private readonly sequelize: Sequelize,
    private readonly cases: SupportCaseRepository,
    private readonly timeline: SupportCaseTimelineRepository,
    private readonly closure: SupportCaseClosureService,
    private readonly actors: SupportActorService,
  ) {}

  /**
   * El cliente pide cerrar o reabrir: se registra como evento y lo resuelve el equipo.
   *
   * Cerrar por petición del cliente sí es inmediato cuando el caso ya estaba resuelto —él es quien
   * mejor sabe si su problema terminó—; pedir la reapertura no lo es en los tipos que exigen
   * revisión humana.
   */
  async registerCustomerRequest(input: {
    tenantId: string;
    actor: SupportActor;
    caseId: string;
    kind: 'CLOSE' | 'REOPEN';
    reason: string;
  }) {
    const supportCase = await this.cases.requireById(input.tenantId, input.caseId);
    await this.actors.assertCanViewCase(input.actor, supportCase, input.tenantId);

    await this.sequelize.transaction((transaction) =>
      this.cases.appendEvent(
        {
          tenantId: input.tenantId,
          caseId: input.caseId,
          eventType: input.kind === 'CLOSE' ? 'CLOSE_REQUESTED' : 'REOPEN_REQUESTED',
          actorType: input.actor.actorType,
          actorId: input.actor.actorId,
          payload: { reason: input.reason },
        },
        transaction,
      ),
    );

    const canCloseNow =
      input.kind === 'CLOSE' &&
      supportCase.status === 'RESOLVED' &&
      !supportCase.legalHold &&
      !NEVER_AUTO_CLOSE_CASE_TYPES.includes(supportCase.caseType as SupportCaseType);

    if (canCloseNow) {
      await this.closure.close({
        tenantId: input.tenantId,
        actor: input.actor,
        caseId: input.caseId,
        dto: { reason: `Cierre a pedido del solicitante: ${input.reason}` },
        automatic: true,
      });
      return { caseId: input.caseId, accepted: true, status: 'CLOSED' };
    }

    return { caseId: input.caseId, accepted: false, status: supportCase.status };
  }

  /** La valoración es del cliente y no se puede editar: la escribe una vez y ahí queda. */
  async submitFeedback(input: { tenantId: string; actor: SupportActor; caseId: string; dto: CaseFeedbackDto }) {
    const supportCase = await this.cases.requireById(input.tenantId, input.caseId);
    await this.actors.assertCanViewCase(input.actor, supportCase, input.tenantId);
    if (!['RESOLVED', 'CLOSED'].includes(supportCase.status)) {
      throw new ConflictException({ code: 'SUPPORT_FEEDBACK_TOO_EARLY', message: 'Podrás valorar cuando el caso esté resuelto.' });
    }

    const existing = await this.timeline.findFeedback(input.caseId, input.actor.actorType, input.actor.actorId);
    if (existing) throw new ConflictException({ code: 'SUPPORT_FEEDBACK_ALREADY_SUBMITTED' });

    await this.sequelize.transaction(async (transaction) => {
      await this.timeline.createFeedback(
        {
          tenantId: input.tenantId,
          caseId: input.caseId,
          respondentActorType: input.actor.actorType,
          respondentActorId: input.actor.actorId,
          csatScore: input.dto.csatScore,
          effortScore: input.dto.effortScore ?? null,
          comment: input.dto.comment ?? null,
          submittedAt: new Date(),
        },
        { transaction },
      );
      await this.cases.appendEvent(
        {
          tenantId: input.tenantId,
          caseId: input.caseId,
          eventType: 'FEEDBACK_SUBMITTED',
          actorType: input.actor.actorType,
          actorId: input.actor.actorId,
          payload: { csatScore: input.dto.csatScore, effortScore: input.dto.effortScore ?? null },
        },
        transaction,
      );
    });

    return { caseId: input.caseId, submitted: true };
  }
}
