/**
 * @file Lo que el extracto bancario VERIFICÓ, tal como entra en la decisión de crédito.
 * @business El ingreso que se mide en la cuenta vale más que el que se escribe en un formulario.
 * @system lee la última revisión de extracto vigente y la traduce a variables del underwriting.
 */
import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { FindOptions, Op } from 'sequelize';
import { BankStatementReviewModel } from '../../database/models/index.js';
import { isStatementTooOld } from '../../common/utils/dates/statement-freshness.util.js';
import { toNumber } from './underwriting-numbers.js';

/**
 * Hasta 2026-10 el artefacto de crédito puntuaba con el ingreso DECLARADO aunque el cliente hubiera subido un
 * extracto: el worker del Motor medía el ingreso reconocido, los rechazos por fondos insuficientes, los meses en
 * negativo, las gestiones de cobranza y el gasto de alto riesgo, y nada de eso llegaba al puntaje. Sólo viajaba la
 * cuota máxima, por la capacidad de pago.
 */
export type StatementSignals = {
  readonly available: boolean;
  /** Ingreso mensual reconocido por el worker (mediana recortada de los meses completos). */
  readonly verifiedMonthlyIncome: number | null;
  /** Obligaciones con terceros observadas en la cuenta, al mes. */
  readonly monthlyObligations: number | null;
  readonly nsfEvents: number;
  readonly monthsNegative: number;
  readonly collectionActions: number;
  readonly highRiskMonths: number;
  /** Fin del período del extracto: la fecha del dato, no la de la revisión. */
  readonly observedAt: Date | null;
};

export const NO_STATEMENT: StatementSignals = {
  available: false,
  verifiedMonthlyIncome: null,
  monthlyObligations: null,
  nsfEvents: 0,
  monthsNegative: 0,
  collectionActions: 0,
  highRiskMonths: 0,
  observedAt: null,
};

type AffordabilityJson = {
  income?: { monthlyRecognized?: number | null } | null;
  obligations?: { monthly?: number | null } | null;
  signals?: {
    nsfEvents?: number | null;
    monthsEndingNegative?: number | null;
    collectionActions?: number | null;
    highRiskMonths?: number | null;
  } | null;
};

/** Pura: de la fila de revisión a las señales. Un extracto no elegible, sin ingreso reconocido o caducado no cuenta. */
export function statementSignalsOf(
  review: Pick<BankStatementReviewModel, 'affordabilityEligible' | 'affordabilityJson' | 'periodTo'> | null,
  now: Date,
): StatementSignals {
  if (!review || review.affordabilityEligible !== true || isStatementTooOld(review.periodTo, now)) return NO_STATEMENT;
  const json = (review.affordabilityJson ?? {}) as AffordabilityJson;
  const income = toNumber(json.income?.monthlyRecognized);
  if (income <= 0) return NO_STATEMENT;
  const end = review.periodTo ? new Date(review.periodTo) : null;
  return {
    available: true,
    verifiedMonthlyIncome: Math.round(income * 100) / 100,
    monthlyObligations: Math.round(toNumber(json.obligations?.monthly) * 100) / 100,
    nsfEvents: toNumber(json.signals?.nsfEvents),
    monthsNegative: toNumber(json.signals?.monthsEndingNegative),
    collectionActions: toNumber(json.signals?.collectionActions),
    highRiskMonths: toNumber(json.signals?.highRiskMonths),
    observedAt: end && Number.isFinite(end.getTime()) ? end : null,
  };
}

type Provenance = 'expediente' | 'derivado' | 'ausente';

/**
 * Las variables que el artefacto 2.2.0 declara para el extracto. Sin extracto viajan en cero y `ausente`: el
 * artefacto sólo las suma cuando `statement_available` es verdadero.
 */
export function statementVariables(
  signals: StatementSignals,
  put: <T>(key: string, value: T, from: Provenance) => T,
): Record<string, unknown> {
  const from: Provenance = signals.available ? 'expediente' : 'ausente';
  return {
    statement_available: put('statement_available', signals.available, 'derivado'),
    statement_verified_income: put('statement_verified_income', signals.verifiedMonthlyIncome ?? 0, from),
    statement_nsf_events: put('statement_nsf_events', signals.nsfEvents, from),
    statement_months_negative: put('statement_months_negative', signals.monthsNegative, from),
    statement_collection_actions: put('statement_collection_actions', signals.collectionActions, from),
    statement_high_risk_months: put('statement_high_risk_months', signals.highRiskMonths, from),
  };
}

/**
 * La fecha de lo que salió del extracto: el fin de su período. Si la cuota se midió contra el ingreso VERIFICADO,
 * `affordability_ratio` y `debt_to_income_ratio` valen lo que el extracto, no lo que el formulario del alta: sin esto
 * un cliente con extracto y sin ingreso declarado mandaba el ratio sin fecha, y una variable crítica sin fecha hace
 * que Core no escriba la decisión.
 */
export function statementObservedAt(signals: StatementSignals, usedForAffordability: boolean): Record<string, Date | null> {
  if (!signals.available || !signals.observedAt) return {};
  const dated: Record<string, Date | null> = {};
  for (const code of [
    'statement_available',
    'statement_verified_income',
    'statement_nsf_events',
    'statement_months_negative',
    'statement_collection_actions',
    'statement_high_risk_months',
  ]) {
    dated[code] = signals.observedAt;
  }
  if (usedForAffordability) {
    dated.affordability_ratio = signals.observedAt;
    dated.debt_to_income_ratio = signals.observedAt;
  }
  return dated;
}

@Injectable()
export class UnderwritingStatementService {
  constructor(@InjectModel(BankStatementReviewModel) private readonly reviews: typeof BankStatementReviewModel) {}

  async signalsFor(tenantId: string, customerId: string, now: Date): Promise<StatementSignals> {
    const review = await this.reviews.findOne({
      where: { tenantId, customerId, deleted: false, affordabilityScore: { [Op.ne]: null } },
      order: [['_created_at', 'DESC']],
    } as FindOptions);
    return statementSignalsOf(review, now);
  }
}
