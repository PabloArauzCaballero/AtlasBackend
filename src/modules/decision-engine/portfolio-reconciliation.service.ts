/**
 * @file Servicio de aplicación: conciliación de la cartera concedida contra lo que el motor sabe (P-11).
 * @business Alerta la ausencia de datos —créditos sin alta, desenlaces perdidos— en vez de declarar cartera sana.
 * @system cuenta en el libro de préstamos y en la cola de desenlaces, y delega el veredicto a una función pura.
 */
import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { Op } from 'sequelize';
import { LoanModel, LoanOutcomeReportModel } from '../../database/models/index.js';
import { DecisionEngineClient } from './decision-engine.client.js';
import { assessPortfolioReconciliation, type PortfolioReconciliation } from './portfolio-reconciliation.js';
import { GRANTED_LOAN_STATUSES } from './facility-registration.service.js';

/** Un crédito recién concedido tiene esta gracia para darse de alta antes de contarse como alerta. */
const REGISTRATION_GRACE_MS = 6 * 3_600_000;
const MAX_OUTCOME_ATTEMPTS = 6;

@Injectable()
export class PortfolioReconciliationService {
  constructor(
    private readonly client: DecisionEngineClient,
    @InjectModel(LoanModel) private readonly loans: typeof LoanModel,
    @InjectModel(LoanOutcomeReportModel) private readonly outcomes: typeof LoanOutcomeReportModel,
  ) {}

  async reconcile(input: { tenantId: string | null; now?: Date }): Promise<PortfolioReconciliation> {
    const now = input.now ?? new Date();
    const scope = input.tenantId ? { tenantId: input.tenantId } : {};
    const granted = { ...scope, deleted: false, disbursedAt: { [Op.ne]: null }, status: { [Op.in]: [...GRANTED_LOAN_STATUSES] } };
    const [grantedWithExecution, grantedWithoutExecution, registeredFacilities, unregisteredStale, pending, exhausted, sent] =
      await Promise.all([
        this.loans.count({ where: { ...granted, decisionExecutionId: { [Op.ne]: null } } }),
        this.loans.count({ where: { ...granted, decisionExecutionId: null } }),
        this.loans.count({
          where: { ...granted, decisionExecutionId: { [Op.ne]: null }, decisionFacilityRegisteredAt: { [Op.ne]: null } },
        }),
        this.loans.count({
          where: {
            ...granted,
            decisionExecutionId: { [Op.ne]: null },
            decisionFacilityRegisteredAt: null,
            disbursedAt: { [Op.lt]: new Date(now.getTime() - REGISTRATION_GRACE_MS) },
          },
        }),
        this.outcomes.count({
          where: { ...scope, status: { [Op.in]: ['pending', 'failed'] }, attempts: { [Op.lt]: MAX_OUTCOME_ATTEMPTS } },
        }),
        this.outcomes.count({ where: { ...scope, status: 'failed', attempts: { [Op.gte]: MAX_OUTCOME_ATTEMPTS } } }),
        this.outcomes.count({ where: { ...scope, status: 'sent' } }),
      ]);
    return assessPortfolioReconciliation({
      engineReportingConfigured: this.client.canReportOutcomes,
      grantedWithExecution,
      grantedWithoutExecution,
      registeredFacilities,
      unregisteredStale,
      outcomesPending: pending,
      outcomesExhausted: exhausted,
      outcomesSent: sent,
    });
  }
}
