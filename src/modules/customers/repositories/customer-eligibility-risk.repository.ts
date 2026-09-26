/**
 * @file Puerto de persistencia: encapsula consultas, locks y escrituras.
 * @business Esta pieza mantiene la identidad operativa, ciclo de vida y elegibilidad del cliente como fuente de verdad.
 * @system expone casos de uso de cliente, evaluación de condiciones y transiciones de estado persistidas.
 */
import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { FindOptions, Op } from 'sequelize';
import {
  DataQualityIssueModel,
  FraudCaseModel,
  ManualReviewCaseModel,
  RiskAssessmentResultModel,
  WatchlistMatchModel,
} from '../../../database/models/index.js';
import type { EligibilityReadOptions } from './customer-eligibility.read-options.js';

const OPEN_CASE_STATUSES = ['open', 'in_review', 'pending', 'escalated'];

/**
 * Lecturas de CUMPLIMIENTO y RIESGO de la regla de habilitación.
 *
 * Viven aparte del resto de los hechos porque responden a una pregunta distinta: los demás miden qué
 * completó el cliente en su registro, y estos cuatro miden qué encontró el banco sobre él —listas de
 * vigilancia, casos de fraude, calificación de riesgo, observaciones abiertas—. Son también los que
 * cambian por decisión de un analista y no por acción del cliente.
 */
@Injectable()
export class CustomerEligibilityRiskRepository {
  constructor(
    @InjectModel(DataQualityIssueModel) private readonly issueModel: typeof DataQualityIssueModel,
    @InjectModel(WatchlistMatchModel) private readonly watchlistMatchModel: typeof WatchlistMatchModel,
    @InjectModel(RiskAssessmentResultModel) private readonly riskResultModel: typeof RiskAssessmentResultModel,
    @InjectModel(FraudCaseModel) private readonly fraudCaseModel: typeof FraudCaseModel,
    @InjectModel(ManualReviewCaseModel) private readonly reviewCaseModel: typeof ManualReviewCaseModel,
  ) {}

  countOpenObservations(tenantId: string, customerId: string, options: EligibilityReadOptions = {}): Promise<number> {
    return this.issueModel.count({
      where: { tenantId, targetRecordId: customerId, resolvedAt: null, issueStatus: { [Op.notIn]: ['resolved', 'dismissed'] } },
      transaction: options.transaction,
    });
  }

  countUnclearedWatchlistMatches(tenantId: string, customerId: string, options: EligibilityReadOptions = {}): Promise<number> {
    return this.watchlistMatchModel.count({ where: { tenantId, customerId }, transaction: options.transaction });
  }

  findLatestRiskResult(
    tenantId: string,
    customerId: string,
    options: EligibilityReadOptions = {},
  ): Promise<RiskAssessmentResultModel | null> {
    return this.riskResultModel.findOne({
      where: { tenantId, customerId },
      order: [['id', 'DESC']],
      transaction: options.transaction,
    } as FindOptions);
  }

  countOpenFraudCases(tenantId: string, customerId: string, options: EligibilityReadOptions = {}): Promise<number> {
    return this.fraudCaseModel.count({
      where: { tenantId, customerId, closedAt: null, caseStatus: { [Op.in]: OPEN_CASE_STATUSES }, deleted: { [Op.ne]: true } },
      transaction: options.transaction,
    });
  }

  /** Casos de revisión manual sin cerrar, usados por el endpoint de observaciones del cliente. */
  findOpenReviewCases(tenantId: string, customerId: string): Promise<ManualReviewCaseModel[]> {
    return this.reviewCaseModel.findAll({
      where: { tenantId, customerId, closedAt: null, deleted: { [Op.ne]: true } },
      order: [['id', 'DESC']],
      limit: 50,
    } as FindOptions);
  }

  /** Incidencias de calidad de datos abiertas del cliente, para la pantalla de observaciones. */
  findOpenIssues(tenantId: string, customerId: string): Promise<DataQualityIssueModel[]> {
    return this.issueModel.findAll({
      where: { tenantId, targetRecordId: customerId, resolvedAt: null, issueStatus: { [Op.notIn]: ['resolved', 'dismissed'] } },
      order: [['id', 'DESC']],
      limit: 50,
    } as FindOptions);
  }
}
