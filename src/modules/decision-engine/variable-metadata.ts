/**
 * @file Utilidad pura: de cuándo es cada variable que Core manda al motor (P-10, `variableMetadata`).
 * @business El motor no concede sobre un dato crítico cuya antigüedad no se puede comprobar; Core le
 *   dice de cuándo es cada dato que conoce, y nunca inventa una fecha que no tiene.
 * @system agrupa las variables por el origen de su fecha y arma `{ código: { observedAt, fetchedAt } }`.
 */
import type { VariableMetadata } from './decision-engine.types.js';

type Provenance = Record<string, 'expediente' | 'derivado' | 'ausente'>;

/** Lo que el solicitante pide en ESTA petición: es cierto al pedir. */
export const REQUEST_VARIABLES = ['requested_amount', 'requested_term_months', 'currency_code', 'product_code', 'purpose_code'] as const;

/**
 * Lo que Core LEE en vivo de su propio libro al decidir (historial dentro de Atlas, contactos
 * verificados, domicilio, edad calculada hoy, antigüedad y fidelización). Es cierto ahora mismo.
 */
export const LIVE_LEDGER_VARIABLES = [
  'no_hit_flag',
  'thin_file_flag',
  'delinquency_count_12m',
  'worst_delinquency_status',
  'charge_off_count',
  'oldest_trade_age_months',
  'inquiries_last_6m',
  'revolving_utilization_ratio',
  'credit_mix_score',
  'payment_history_score',
  'velocity_applications_24h',
  'age',
  'email_verified',
  'phone_verified',
  'address_verified',
  'relationship_score',
  'relationship_tier',
  'tenure_score',
  'loyalty_score',
] as const;

/** Lo que el cliente DECLARÓ en su expediente económico, y lo que se deriva de ello: vale lo que valga su captura. */
export const DECLARED_ECONOMY_VARIABLES = [
  'declared_monthly_income',
  'disposable_income',
  'affordability_ratio',
  'debt_to_income_ratio',
  'income_stability_score',
  'employment_status',
  'self_employed_flag',
  'source_of_funds_verified',
] as const;

/** El resultado de la verificación de identidad: vale desde que el proveedor la completó. */
export const IDENTITY_VARIABLES = [
  'kyc_status',
  'national_id_verified',
  'liveness_check_passed',
  'biometric_match_score',
  'identity_confidence_score',
] as const;

export type MetadataDates = {
  now: Date;
  provenance: Provenance;
  /** La captura MÁS ANTIGUA de los atributos económicos usados (conservador), o `null` si no se sabe. */
  economyObservedAt: Date | null;
  identityObservedAt: Date | null;
  /** Fechas propias de otras variables (p. ej. del feature store). Pisan a las de grupo. */
  observed?: Record<string, Date | null | undefined>;
};

/**
 * Arma `variableMetadata` con las fechas que Core CONOCE.
 *
 * Lo `ausente` no lleva fecha: viaja con un valor neutro y afirmar su frescura sería mentir. Lo
 * declarado sin fecha conocida tampoco: el motor lo marcará como desconocido y, si es crítico, Core
 * no concederá solo. `fetchedAt` sólo acompaña a lo que Core lee en vivo; a un dato declarado hace
 * meses no se le pone «obtenido ahora», porque el motor usaría esa fecha y lo daría por fresco.
 */
export function buildVariableMetadata(input: MetadataDates): VariableMetadata {
  const now = input.now.toISOString();
  const result: VariableMetadata = {};
  const known = (code: string) => input.provenance[code] !== 'ausente';

  for (const code of REQUEST_VARIABLES) result[code] = { observedAt: now };
  for (const code of LIVE_LEDGER_VARIABLES) {
    if (code in input.provenance && known(code)) result[code] = { observedAt: now, fetchedAt: now };
  }
  assignGroup(result, DECLARED_ECONOMY_VARIABLES, input.economyObservedAt, input.provenance);
  assignGroup(result, IDENTITY_VARIABLES, input.identityObservedAt, input.provenance);
  for (const [code, date] of Object.entries(input.observed ?? {})) {
    if (date && !Number.isNaN(date.getTime())) result[code] = { observedAt: date.toISOString() };
  }
  return result;
}

function assignGroup(result: VariableMetadata, codes: readonly string[], date: Date | null, provenance: Provenance): void {
  if (!date || Number.isNaN(date.getTime())) return;
  for (const code of codes) {
    if (code in provenance && provenance[code] !== 'ausente') result[code] = { observedAt: date.toISOString() };
  }
}
