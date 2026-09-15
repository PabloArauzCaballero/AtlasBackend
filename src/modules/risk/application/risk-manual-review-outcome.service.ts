/**
 * @file Servicio de aplicación o dominio: ejecuta reglas y coordina dependencias.
 * @business Esta pieza cierra el circuito de la revisión humana de riesgo hecha en el Motor.
 * @system aplica la resolución del Motor al caso delegado, corrige el resultado de riesgo y reevalúa la habilitación.
 */
import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectConnection } from '@nestjs/sequelize';
import { Sequelize } from 'sequelize-typescript';
import { CustomerEligibilityService } from '../../customers/application/customer-eligibility.service.js';
import { RevisionManualRepository } from '../repositories/revision-manual.repository.js';
import { RiskRepository } from '../risk.repository.js';

export type EngineManualReviewDecision = 'APPROVE' | 'DECLINE';

/**
 * Lo que pasa cuando el analista resuelve EN el Motor un caso de riesgo de onboarding.
 *
 * Antes no pasaba nada. `openManualReviewCase` dejaba el caso local delegado (con
 * `decision_execution_id`), `OperationsService` lo rechazaba con `MANUAL_REVIEW_DELEGADA_AL_MOTOR`,
 * y el Motor sólo avisaba de vuelta para la cola de IDENTIDAD. El cliente se quedaba con
 * `RISK_NOT_APPROVED` para siempre y ninguna de las dos consolas podía moverlo: un callejón sin
 * salida con las dos puertas cerradas a propósito.
 *
 * Aquí se hacen las tres cosas que la resolución humana local hacía por separado, en UNA
 * transacción: cerrar el caso ancla, corregir el resultado de riesgo (que es lo que lee la
 * elegibilidad) y reevaluar la habilitación, que puede activar al cliente sola si sólo le faltaba esto.
 */
@Injectable()
export class RiskManualReviewOutcomeService {
  private readonly logger = new Logger(RiskManualReviewOutcomeService.name);

  constructor(
    private readonly revisionManual: RevisionManualRepository,
    private readonly riskRepository: RiskRepository,
    private readonly eligibility: CustomerEligibilityService,
    @InjectConnection() private readonly sequelize: Sequelize,
  ) {}

  async apply(input: {
    tenantId: string;
    executionId: string;
    decision: EngineManualReviewDecision;
    reason: string;
    resolvedByInternalUserId: string | null;
  }) {
    return this.sequelize.transaction(async (transaction) => {
      const reviewCase = await this.revisionManual.findManualReviewCaseByExecutionId(input.tenantId, input.executionId, { transaction });
      if (!reviewCase) throw new NotFoundException(`Ningún caso de riesgo nació de la ejecución ${input.executionId}.`);
      if (reviewCase.closedAt || reviewCase.status === 'closed') {
        return { applied: false, reason: 'CASE_ALREADY_CLOSED', caseId: String(reviewCase.id) };
      }

      const now = new Date();
      const approved = input.decision === 'APPROVE';
      const resolution = approved ? 'approved' : 'rejected';

      await this.revisionManual.closeManualReviewCase(
        reviewCase,
        { resolution, notes: `Resuelto en el Motor de Decisión: ${input.reason}`, closedAt: now },
        { transaction },
      );

      const result = reviewCase.riskAssessmentRunId
        ? await this.riskRepository.findRiskResultByRun(input.tenantId, reviewCase.riskAssessmentRunId)
        : null;
      if (result) {
        await this.riskRepository.applyManualReviewOutcome(
          result,
          { recommendedAction: approved ? 'approved_for_next_step' : 'rejected', reason: input.reason, now },
          { transaction },
        );
      }

      let lifecycleStatus: string | null = null;
      if (reviewCase.customerId) {
        const evaluation = await this.eligibility.evaluateAndRecord({
          tenantId: input.tenantId,
          customerId: String(reviewCase.customerId),
          evaluatedByType: 'decision_engine_manual_review',
          evaluatedByInternalUserId: input.resolvedByInternalUserId,
          decisionSource: 'manual_decision',
          reasonCode: approved ? 'risk_manual_review_approved' : 'risk_manual_review_rejected',
          notes: input.reason,
          transaction,
        });
        lifecycleStatus = evaluation.lifecycleStatus;
      }

      this.logger.log(
        `Revisión de riesgo del Motor aplicada: ejecución=${input.executionId} caso=${reviewCase.id} resolución=${resolution} ` +
          `cliente=${reviewCase.customerId ?? 'sin-cliente'} estado=${lifecycleStatus ?? 'sin-evaluar'}`,
      );

      return { applied: true, caseId: String(reviewCase.id), resolution, lifecycleStatus };
    });
  }
}
