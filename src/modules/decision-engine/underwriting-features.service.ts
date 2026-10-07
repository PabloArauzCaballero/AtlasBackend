/**
 * @file Servicio de aplicación o dominio: ejecuta reglas y coordina dependencias.
 * @business Esta pieza convierte lo que Atlas sabe del cliente en las variables con las que se decide su crédito.
 * @system arma el contrato de entrada del artefacto de suscripción desde el expediente real del cliente.
 */
import { Injectable, Logger } from '@nestjs/common';

import { env } from '../../config/env.js';
import { UnderwritingSignalsService } from './underwriting-signals.service.js';
import { UnderwritingCreditHistoryService } from './underwriting-credit-history.service.js';
import { UnderwritingDeviceSignalsService, variablesEnVivo } from './underwriting-device-signals.service.js';
import { UnderwritingTrustSignalsService } from './underwriting-trust-signals.service.js';
import { fraudDefaults, variablesDeConfianza } from './trust-signals.js';
import { UnderwritingStatementService, statementObservedAt, statementVariables } from './underwriting-statement.service.js';
import { clamp, EMPLOYMENT_MAP, incomeBasis } from './underwriting-income-basis.js';
import type { VariableMetadata } from './decision-engine.types.js';
import { buildVariableMetadata } from './variable-metadata.js';

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
  /** De cuándo es cada dato que Core conoce (P-10). Lo que no tiene fecha no aparece. */
  variableMetadata: VariableMetadata;
  /** Las fechas de grupo, para quien añade variables propias (el recálculo de línea). */
  observedAt: { economy: Date | null; identity: Date | null };
  /** El ingreso con el que se midió `affordability_ratio`: el verificado por extracto si lo hay, si no el declarado. */
  affordabilityIncome: number;
  deviceSignals?: Awaited<ReturnType<UnderwritingDeviceSignalsService['signalsFor']>>;
};

const MISSING = 'ausente' as const;

/**
 * Lo que se manda cuando Atlas NO sabe algo de cumplimiento (C-6).
 *
 * Las variables categóricas viajan con este centinela y las booleanas con `null`: ninguna con el
 * valor «limpio» (`CLEAR`, `false`, `NONE`), que la política leería como «se cotejó y salió bien».
 * Mandar «limpio» por no saber es decidir a favor del solicitante sobre una pregunta que nadie
 * contestó. La política decide qué hacer con la ausencia —normalmente, revisión humana—; el core no
 * le miente para conseguir una aprobación. Ojo: un artefacto cuyo contrato no admita el centinela
 * (enum cerrado, variable obligatoria) responderá `NO_DECISION` y la solicitud irá a revisión con su
 * caso, no a aprobación: es el fallo seguro.
 */
export const NOT_ASSESSED = 'MISSING' as const;
const FILE = 'expediente' as const;
const DERIVED = 'derivado' as const;

/** Los códigos de atributo económico que el alta recoge, tal y como los guarda el catálogo. */
const INCOME = 'monthly_income_declared';
const OTHER_INCOME = 'other_monthly_income';
const EXPENSES = 'monthly_expenses_declared';
const SENIORITY = 'employment_seniority_months';

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
 * al alza le niega crédito a quien nunca lo pidió. La excepción es cumplimiento y fraude, donde el
 * valor «neutro» sería «limpio»: ahí lo que no se sabe viaja como ausente (`NOT_ASSESSED`, o `null`
 * en las booleanas), porque un «limpio» inventado aprueba a quien nadie ha cotejado (C-6).
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
    private readonly deviceSignals: UnderwritingDeviceSignalsService,
    private readonly statement: UnderwritingStatementService,
    private readonly trust: UnderwritingTrustSignalsService,
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

    const [economy, contactState, hasAddress, identity, history, complianceSignals, extracto, telefono, confianza] = await Promise.all([
      this.signals.economicAttributes(input.tenantId, input.customerId),
      this.signals.contactVerification(input.tenantId, input.customerId),
      this.signals.hasVerifiedAddress(input.tenantId, input.customerId),
      this.signals.identitySignals(input.tenantId, input.customerId),
      this.historial.creditHistory(input.tenantId, input.customerId, now),
      this.signals.complianceSignals(input.tenantId, input.customerId),
      this.statement.signalsFor(input.tenantId, input.customerId, now),
      this.deviceSignals.signalsFor(input.tenantId, input.customerId, now),
      this.trust.signalsFor(input.tenantId, input.customerId, now),
    ]);
    const income = economy[INCOME] ?? 0;
    const otherIncome = economy[OTHER_INCOME] ?? 0;
    // Sin gastos (el alta ya no los pide, eligibility-v2) disponible y deuda-ingreso viajan `ausente`: nada de «gasta 0».
    const expensesKnown = Number.isFinite(economy[EXPENSES]);
    const expenses = expensesKnown ? economy[EXPENSES]! : 0;
    const totalIncome = income + otherIncome;
    const disposable = Math.max(0, totalIncome - expenses);

    /*
     * La cuota estimada de ESTA compra sobre el ingreso: es lo que el artefacto llama
     * `affordability_ratio`. Se calcula con el plazo pedido y no con uno fijo, porque pedir 3.000 a
     * tres meses y pedirlos a doce no comprometen el mismo sueldo.
     */
    const monthlyInstalment = input.requestedTermMonths > 0 ? input.requestedAmount / input.requestedTermMonths : input.requestedAmount;
    const { verified, affordabilityIncome, affordabilityRatio, debtKnown, debtToIncome } = incomeBasis({
      extracto,
      monthlyInstalment,
      declaredIncome: totalIncome,
      expenses,
      expensesKnown,
      monthlyCommitted: history.monthlyCommitted,
    });

    const employmentRaw = String(economy.__employmentStatus ?? '').toLowerCase();
    const employment = employmentRaw ? (EMPLOYMENT_MAP[employmentRaw] ?? 'UNKNOWN') : 'UNKNOWN';
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
      disposable_income: put('disposable_income', Math.round(disposable * 100) / 100, expensesKnown ? DERIVED : MISSING),
      affordability_ratio: put('affordability_ratio', affordabilityRatio, verified > 0 ? FILE : DERIVED),
      debt_to_income_ratio: put('debt_to_income_ratio', Math.round(debtToIncome * 1000) / 1000, debtKnown ? DERIVED : MISSING),
      /*
       * La estabilidad se estima con la antigüedad en el empleo: dos años ya es un ingreso que se
       * ha sostenido, y por encima de eso el dato deja de discriminar. Es una aproximación honesta
       * mientras no haya extractos —cuando los hay, el recálculo la sustituye.
       */
      income_stability_score: put(
        'income_stability_score',
        seniorityMonths > 0 ? clamp(Math.round((seniorityMonths / 24) * 100), 0, 100) : 50,
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
      /*
       * `age` YA NO viaja desde aquí (C-6). El catálogo la declara prohibida para decidir crédito
       * (`edad`: `allowed_for_credit_decision = false`, motivo `SOLO_ELEGIBILIDAD_LEGAL`, revisión
       * legal `restricted`), y este servicio la mandaba saltándose el gobierno que
       * `FeatureProjectionService` sí aplica al feature store: la política recibía una variable que
       * nadie había autorizado usar. La mayoría de edad se comprueba en la elegibilidad, antes de
       * poder pedir crédito. Si una política necesita la edad, entra por el feature store
       * (`age`, con su revisión legal aprobada) y `projected.variables` la superpone.
       */
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
      /*
       * Ninguno de estos valores es «limpio» salvo que Atlas lo sepa (C-6). No hay fuente de PEP, ni
       * un cotejo OFAC, y el cotejo de listas restrictivas es una acción manual cuya ausencia de
       * resultado no distingue «salió limpio» de «nunca se hizo»: ver `UnderwritingSignalsService.complianceSignals`.
       * Sólo una coincidencia ACTIVA es un hecho, y ése es el único valor que se afirma.
       */
      pep_status: put('pep_status', null, MISSING),
      pep_relationship_type: put('pep_relationship_type', NOT_ASSESSED, MISSING),
      sanctions_screening_result: put(
        'sanctions_screening_result',
        complianceSignals.activeWatchlistMatch ? 'POTENTIAL_MATCH' : NOT_ASSESSED,
        complianceSignals.activeWatchlistMatch ? FILE : MISSING,
      ),
      ofac_screening_result: put('ofac_screening_result', NOT_ASSESSED, MISSING),
      adverse_media_hit: put('adverse_media_hit', false, MISSING),
      high_risk_jurisdiction_flag: put('high_risk_jurisdiction_flag', false, MISSING),

      // ---------------------------------------------------------------- fraude y dispositivo
      ...fraudDefaults(put, complianceSignals.openFraudCase, history.applications24h),

      // ---------------------------------------------------------------- normativa
      /**
       * Tope legal de la Ley N.º 393; la política no puede tarificar por encima.
       *
       * Sale de `env.USURY_CAP_RATE` y no de una constante (T-4, Frente 3A): es la MISMA fuente que
       * `loan-disbursement.service.ts` usa para clampear de verdad al desembolsar. Antes este valor
       * viajaba al Motor pero nada en el core lo hacía cumplir; ahora un solo número gobierna las
       * dos puntas.
       */
      usury_cap_rate: put('usury_cap_rate', env.USURY_CAP_RATE, FILE),

      ...statementVariables(extracto, put),
    };

    // Teléfono y cotejos contra los registros propios (lista negra, casos, dispositivos, IP) pisan a los ausentes que ya viajaban.
    const enVivo = [...variablesEnVivo(telefono), ...variablesDeConfianza(confianza, env.UNDERWRITING_DEVICE_SIGNALS_MODE)];
    for (const [codigo, valor] of enVivo) variables[codigo] = put(codigo, valor, DERIVED);
    const observedAt = {
      economy: (economy.__observedAt as unknown as Date | null | undefined) ?? null,
      identity: identity.observedAt ?? null,
    };
    const variableMetadata = buildVariableMetadata({
      now,
      provenance,
      economyObservedAt: observedAt.economy,
      identityObservedAt: observedAt.identity,
      observed: statementObservedAt(extracto, verified > 0),
    });
    return { variables, provenance, variableMetadata, observedAt, affordabilityIncome, deviceSignals: telefono };
  }
}
