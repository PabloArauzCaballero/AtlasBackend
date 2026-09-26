/**
 * @file Servicio de aplicación o dominio: ejecuta reglas y coordina dependencias.
 * @business Esta pieza convierte lo que Atlas sabe del cliente en las variables con las que se decide su crédito.
 * @system arma el contrato de entrada del artefacto de suscripción desde el expediente real del cliente.
 */
import { Injectable, Logger } from '@nestjs/common';

import {} from '../../database/models/index.js';
import { UnderwritingSignalsService } from './underwriting-signals.service.js';
import { UnderwritingCreditHistoryService } from './underwriting-credit-history.service.js';

/** Lo que se manda al motor, y de dónde salió cada cosa. */
export type UnderwritingFeatures = {
  variables: Record<string, unknown>;
  /**
   * De dónde viene cada variable: `expediente` si es un dato real del cliente, `derivado` si se
   * calculó a partir de ellos, `ausente` si Atlas todavía no lo tiene y viaja con su valor neutro.
   *
   * No es adorno de auditoría: es la diferencia entre «el buró dice que no» y «no hay buró en el
   * país todavía», y el cliente tiene derecho a que no se le presenten igual.
   */
  provenance: Record<string, 'expediente' | 'derivado' | 'ausente'>;
};

const MISSING = 'ausente' as const;
const FILE = 'expediente' as const;
const DERIVED = 'derivado' as const;

/** Los códigos de atributo económico que el alta recoge, tal y como los guarda el catálogo. */
const INCOME = 'monthly_income_declared';
const OTHER_INCOME = 'other_monthly_income';
const EXPENSES = 'monthly_expenses_declared';
const SENIORITY = 'employment_seniority_months';

/** Del vocabulario del alta al del artefacto. Lo que no encaje va a `UNEMPLOYED`, que no aprueba. */
const EMPLOYMENT_MAP: Record<string, string> = {
  employee: 'EMPLOYED',
  employed: 'EMPLOYED',
  self_employed: 'SELF_EMPLOYED',
  independent: 'SELF_EMPLOYED',
  business_owner: 'SELF_EMPLOYED',
  retired: 'RETIRED',
  student: 'STUDENT',
  unemployed: 'UNEMPLOYED',
};

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value));
}

/**
 * El expediente del cliente, traducido al contrato del motor.
 *
 * ## Por qué existe
 *
 * El core mandaba al motor cinco variables —el importe, el plazo, la moneda, el producto y el
 * propósito— y ni una sola del cliente. El artefacto declara cincuenta y siete entradas, entre ellas
 * el ingreso disponible, la relación deuda-ingreso y el historial de mora; sin ellas, la política
 * decidía sobre el vacío y el límite que salía era el mismo para todo el mundo.
 *
 * ## Qué se manda y qué no
 *
 * Se manda lo que Atlas SABE. Lo que no sabe viaja con un valor neutro declarado y queda marcado
 * como `ausente`, nunca inventado como si fuera un dato: la diferencia entre «no tiene historial» y
 * «tiene mal historial» es la diferencia entre un cliente nuevo y uno que ya falló, y confundirlas
 * al alza le niega crédito a quien nunca lo pidió.
 *
 * En Bolivia no hay buró de crédito conectado todavía, así que `bureau_score` no se rellena: se
 * declara `no_hit_flag` y `thin_file_flag`, que es exactamente lo que ocurre. La política decide qué
 * hacer con eso; el core no le miente para conseguir una aprobación.
 */
@Injectable()
export class UnderwritingFeaturesService {
  private readonly logger = new Logger(UnderwritingFeaturesService.name);

  constructor(
    private readonly signals: UnderwritingSignalsService,
    private readonly historial: UnderwritingCreditHistoryService,
  ) {}

  async build(input: {
    tenantId: string;
    customerId: string;
    requestedAmount: number;
    requestedTermMonths: number;
    /** Rechazos por fondos insuficientes leídos del extracto bancario, si el cliente lo subió. */
    bankStatementNsfCount?: number | null;
    now?: Date;
  }): Promise<UnderwritingFeatures> {
    const now = input.now ?? new Date();
    const provenance: Record<string, 'expediente' | 'derivado' | 'ausente'> = {};
    const put = <T>(key: string, value: T, from: 'expediente' | 'derivado' | 'ausente'): T => {
      provenance[key] = from;
      return value;
    };

    const [economy, profile, contactState, hasAddress, identity, history] = await Promise.all([
      this.signals.economicAttributes(input.tenantId, input.customerId),
      this.signals.currentProfile(input.tenantId, input.customerId),
      this.signals.contactVerification(input.tenantId, input.customerId),
      this.signals.hasVerifiedAddress(input.tenantId, input.customerId),
      this.signals.identitySignals(input.tenantId, input.customerId),
      this.historial.creditHistory(input.tenantId, input.customerId, now),
    ]);

    const income = economy[INCOME] ?? 0;
    const otherIncome = economy[OTHER_INCOME] ?? 0;
    const expenses = economy[EXPENSES] ?? 0;
    const totalIncome = income + otherIncome;
    const disposable = Math.max(0, totalIncome - expenses);

    /*
     * La cuota estimada de ESTA compra sobre el ingreso: es lo que el artefacto llama
     * `affordability_ratio`. Se calcula con el plazo pedido y no con uno fijo, porque pedir 3.000 a
     * tres meses y pedirlos a doce no comprometen el mismo sueldo.
     */
    const monthlyInstalment = input.requestedTermMonths > 0 ? input.requestedAmount / input.requestedTermMonths : input.requestedAmount;
    const affordabilityRatio = totalIncome > 0 ? clamp(monthlyInstalment / totalIncome, 0, 5) : 5;
    const debtToIncome = totalIncome > 0 ? clamp((expenses + history.monthlyCommitted) / totalIncome, 0, 5) : 5;

    const employmentRaw = String(economy.__employmentStatus ?? '').toLowerCase();
    const employment = EMPLOYMENT_MAP[employmentRaw] ?? 'UNEMPLOYED';
    const seniorityMonths = economy[SENIORITY] ?? 0;

    const variables: Record<string, unknown> = {
      requested_amount: put('requested_amount', input.requestedAmount, FILE),
      requested_term_months: put('requested_term_months', input.requestedTermMonths, FILE),

      // ---------------------------------------------------------------- capacidad de pago
      /*
       * El ingreso DECLARADO viaja explícito, y no sólo dentro de `disposable_income`.
       *
       * Es lo que permite que el resto del sistema distinga «gana esto según sus movimientos» de
       * «gana esto según dijo en el formulario». Sin él, el modelo de capacidad no tendría con qué
       * proponer un límite conservador al cliente que todavía no subió su extracto, y ese cliente
       * se quedaría en cero — convirtiendo el extracto en un requisito de facto.
       */
      declared_monthly_income: put('declared_monthly_income', Math.round(totalIncome * 100) / 100, income > 0 ? FILE : MISSING),
      disposable_income: put('disposable_income', Math.round(disposable * 100) / 100, DERIVED),
      affordability_ratio: put('affordability_ratio', Math.round(affordabilityRatio * 1000) / 1000, DERIVED),
      debt_to_income_ratio: put('debt_to_income_ratio', Math.round(debtToIncome * 1000) / 1000, DERIVED),
      /*
       * La estabilidad se estima con la antigüedad en el empleo: dos años ya es un ingreso que se
       * ha sostenido, y por encima de eso el dato deja de discriminar. Es una aproximación honesta
       * mientras no haya extractos —cuando los hay, el recálculo la sustituye.
       */
      income_stability_score: put(
        'income_stability_score',
        seniorityMonths > 0 ? clamp(Math.round((seniorityMonths / 24) * 100), 0, 100) : 0,
        seniorityMonths > 0 ? DERIVED : MISSING,
      ),
      employment_status: put('employment_status', employment, employmentRaw ? FILE : MISSING),
      self_employed_flag: put('self_employed_flag', employment === 'SELF_EMPLOYED', employmentRaw ? FILE : MISSING),
      bank_statement_nsf_count: put(
        'bank_statement_nsf_count',
        input.bankStatementNsfCount ?? 0,
        input.bankStatementNsfCount === null || input.bankStatementNsfCount === undefined ? MISSING : FILE,
      ),
      tax_return_verified: put('tax_return_verified', false, MISSING),
      source_of_funds_verified: put('source_of_funds_verified', Boolean(economy.__sourceOfFunds), economy.__sourceOfFunds ? FILE : MISSING),

      // ---------------------------------------------------------------- historial crediticio
      /*
       * Sin buró conectado en el país, `bureau_score` no se inventa: se declara la ausencia con
       * `no_hit_flag` y `thin_file_flag`, que es lo que de verdad pasa. Rellenarlo con un número
       * plausible seria decidir en nombre de una fuente que no existe.
       */
      bureau_score: put('bureau_score', 0, MISSING),
      no_hit_flag: put('no_hit_flag', history.loanCount === 0, DERIVED),
      thin_file_flag: put('thin_file_flag', history.loanCount < 3, DERIVED),
      delinquency_count_12m: put('delinquency_count_12m', history.delinquencyCount12m, FILE),
      worst_delinquency_status: put('worst_delinquency_status', history.worstStatus, FILE),
      charge_off_count: put('charge_off_count', history.chargeOffCount, FILE),
      public_records_count: put('public_records_count', 0, MISSING),
      bankruptcy_flag: put('bankruptcy_flag', false, MISSING),
      oldest_trade_age_months: put('oldest_trade_age_months', history.oldestTradeAgeMonths, FILE),
      inquiries_last_6m: put('inquiries_last_6m', history.applications6m, FILE),
      revolving_utilization_ratio: put('revolving_utilization_ratio', history.utilization, DERIVED),
      credit_mix_score: put('credit_mix_score', history.loanCount > 0 ? 50 : 0, DERIVED),
      payment_history_score: put('payment_history_score', history.paymentHistoryScore, DERIVED),

      // ---------------------------------------------------------------- identidad y contacto
      age: put('age', profile.age, profile.age > 0 ? FILE : MISSING),
      kyc_status: put('kyc_status', identity.verified ? 'VERIFIED' : 'PENDING', FILE),
      national_id_verified: put('national_id_verified', identity.verified, FILE),
      address_verified: put('address_verified', hasAddress, FILE),
      email_verified: put('email_verified', contactState.emailVerified, FILE),
      phone_verified: put('phone_verified', contactState.phoneVerified, FILE),
      liveness_check_passed: put('liveness_check_passed', identity.liveness, identity.inferred ? DERIVED : FILE),
      biometric_match_score: put(
        'biometric_match_score',
        identity.matchScore,
        identity.inferred ? DERIVED : identity.matchScore > 0 ? FILE : MISSING,
      ),
      identity_confidence_score: put(
        'identity_confidence_score',
        identity.confidence,
        identity.inferred ? DERIVED : identity.confidence > 0 ? FILE : MISSING,
      ),
      synthetic_identity_score: put('synthetic_identity_score', 0, MISSING),
      consent_active: put('consent_active', true, FILE),

      // ---------------------------------------------------------------- cumplimiento
      pep_status: put('pep_status', false, MISSING),
      pep_relationship_type: put('pep_relationship_type', 'NONE', MISSING),
      sanctions_screening_result: put('sanctions_screening_result', 'CLEAR', MISSING),
      ofac_screening_result: put('ofac_screening_result', 'CLEAR', MISSING),
      adverse_media_hit: put('adverse_media_hit', false, MISSING),
      high_risk_jurisdiction_flag: put('high_risk_jurisdiction_flag', false, MISSING),

      // ---------------------------------------------------------------- fraude y dispositivo
      /*
       * `NEUTRAL` y no `UNKNOWN`: el artefacto solo admite TRUSTED, NEUTRAL, SUSPICIOUS o
       * BLOCKLISTED, y un valor fuera del enum aborta la ejecución entera —el motor devolvió
       * `VARIABLE_MISSING_OR_INVALID` y la línea se quedó sin calcular—. Neutral es exactamente lo
       * que Atlas sabe hoy del dispositivo: nada ni a favor ni en contra.
       */
      device_reputation: put('device_reputation', 'NEUTRAL', MISSING),
      device_risk_score: put('device_risk_score', 0, MISSING),
      ip_address_risk_score: put('ip_address_risk_score', 0, MISSING),
      ip_tor_detected: put('ip_tor_detected', false, MISSING),
      geolocation_mismatch_flag: put('geolocation_mismatch_flag', false, MISSING),
      sim_swap_detected: put('sim_swap_detected', false, MISSING),
      browser_automation_detected: put('browser_automation_detected', false, MISSING),
      known_fraud_device_flag: put('known_fraud_device_flag', false, MISSING),
      known_fraud_email_flag: put('known_fraud_email_flag', false, MISSING),
      known_fraud_phone_flag: put('known_fraud_phone_flag', false, MISSING),
      previous_fraud_case_flag: put('previous_fraud_case_flag', false, MISSING),
      fraud_signal: put('fraud_signal', false, MISSING),
      account_takeover_risk_score: put('account_takeover_risk_score', 0, MISSING),
      velocity_applications_24h: put('velocity_applications_24h', history.applications24h, FILE),

      // ---------------------------------------------------------------- normativa
      /** Tope legal de la Ley N.º 393; la política no puede tarificar por encima. */
      usury_cap_rate: put('usury_cap_rate', 0.24, FILE),
    };

    return { variables, provenance };
  }
}
