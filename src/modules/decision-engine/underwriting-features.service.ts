/**
 * @file Servicio de aplicación o dominio: ejecuta reglas y coordina dependencias.
 * @business Esta pieza convierte lo que Atlas sabe del cliente en las variables con las que se decide su crédito.
 * @system arma el contrato de entrada del artefacto de suscripción desde el expediente real del cliente.
 */
import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { FindOptions, Op } from 'sequelize';
import {
  AttributeDefinitionModel,
  CustomerAddressModel,
  CustomerAttributeValueModel,
  CustomerContactMethodModel,
  CustomerProfileVersionModel,
  IdentityVerificationAttemptModel,
  LoanInstallmentModel,
  LoanModel,
} from '../../database/models/index.js';

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

/**
 * El puntaje que Atlas atestigua cuando el proveedor verificó pero no desglosó.
 *
 * Es deliberadamente el mínimo aprobatorio y no un valor alto: se afirma «pasó», no «pasó
 * brillantemente». La diferencia importa porque estos puntajes ponderan la decisión.
 */
const ATTESTED_PASS = 70;

const MISSING = 'ausente' as const;
const FILE = 'expediente' as const;
const DERIVED = 'derivado' as const;

/** Los códigos de atributo económico que el alta recoge, tal y como los guarda el catálogo. */
const INCOME = 'monthly_income_declared';
const OTHER_INCOME = 'other_monthly_income';
const EXPENSES = 'monthly_expenses_declared';
const EMPLOYMENT = 'employment_status';
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

/** Del tramo de mora del préstamo al enum del artefacto. */
const DELINQUENCY_MAP: Record<string, string> = {
  current: 'CURRENT',
  dpd_1_29: 'DPD_30',
  dpd_30_59: 'DPD_30',
  dpd_60_89: 'DPD_60',
  dpd_90_119: 'DPD_90',
  dpd_120_plus: 'DPD_120_PLUS',
  charged_off: 'CHARGE_OFF',
};

function toNumber(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

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
    @InjectModel(CustomerAttributeValueModel) private readonly attributeValues: typeof CustomerAttributeValueModel,
    @InjectModel(AttributeDefinitionModel) private readonly attributeDefinitions: typeof AttributeDefinitionModel,
    @InjectModel(CustomerProfileVersionModel) private readonly profiles: typeof CustomerProfileVersionModel,
    @InjectModel(CustomerContactMethodModel) private readonly contacts: typeof CustomerContactMethodModel,
    @InjectModel(CustomerAddressModel) private readonly addresses: typeof CustomerAddressModel,
    @InjectModel(IdentityVerificationAttemptModel) private readonly identityAttempts: typeof IdentityVerificationAttemptModel,
    @InjectModel(LoanModel) private readonly loans: typeof LoanModel,
    @InjectModel(LoanInstallmentModel) private readonly installments: typeof LoanInstallmentModel,
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
      this.economicAttributes(input.tenantId, input.customerId),
      this.currentProfile(input.tenantId, input.customerId),
      this.contactVerification(input.tenantId, input.customerId),
      this.hasVerifiedAddress(input.tenantId, input.customerId),
      this.identitySignals(input.tenantId, input.customerId),
      this.creditHistory(input.tenantId, input.customerId, now),
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

  /** Los atributos económicos vigentes, por código. */
  private async economicAttributes(tenantId: string, customerId: string): Promise<Record<string, number> & Record<string, unknown>> {
    const definitions = await this.attributeDefinitions.findAll({
      where: { attributeCode: { [Op.in]: [INCOME, OTHER_INCOME, EXPENSES, EMPLOYMENT, SENIORITY, 'source_of_funds'] } },
    } as FindOptions);
    if (definitions.length === 0) return {} as Record<string, number>;

    const byId = new Map(definitions.map((definition) => [String(definition.id), definition.attributeCode]));
    const values = await this.attributeValues.findAll({
      where: { tenantId, customerId, attributeDefinitionId: { [Op.in]: [...byId.keys()] } },
      order: [['_id', 'DESC']],
    } as FindOptions);

    const result: Record<string, unknown> = {};
    const seen = new Set<string>();
    for (const value of values) {
      const code = byId.get(String(value.attributeDefinitionId));
      if (!code || seen.has(code)) continue;
      seen.add(code);

      if (code === EMPLOYMENT) result.__employmentStatus = value.valueText ?? null;
      else if (code === 'source_of_funds') result.__sourceOfFunds = value.valueText ?? null;
      else result[code] = toNumber(value.valueNumber);
    }
    return result as Record<string, number> & Record<string, unknown>;
  }

  private async currentProfile(tenantId: string, customerId: string): Promise<{ age: number }> {
    const profile = await this.profiles.findOne({
      where: { tenantId, customerId, validUntil: null },
      order: [['_id', 'DESC']],
    } as FindOptions);

    if (!profile?.birthDate) return { age: 0 };
    const born = new Date(`${String(profile.birthDate).slice(0, 10)}T00:00:00Z`);
    if (Number.isNaN(born.getTime())) return { age: 0 };
    return { age: Math.floor((Date.now() - born.getTime()) / (365.25 * 86_400_000)) };
  }

  private async contactVerification(tenantId: string, customerId: string): Promise<{ emailVerified: boolean; phoneVerified: boolean }> {
    const methods = await this.contacts.findAll({ where: { tenantId, customerId } } as FindOptions);
    return {
      emailVerified: methods.some((method) => method.emailDomain !== null && method.status === 'verified'),
      phoneVerified: methods.some((method) => method.emailDomain === null && method.status === 'verified'),
    };
  }

  private async hasVerifiedAddress(tenantId: string, customerId: string): Promise<boolean> {
    const count = await this.addresses.count({ where: { tenantId, customerId } } as FindOptions);
    return count > 0;
  }

  /**
   * Lo que Atlas sabe de la identidad, sin confundir «no registrado» con «falló».
   *
   * El proveedor devuelve un veredicto y, cuando el canal lo permite, los puntajes que lo sostienen.
   * En el paquete de alta el veredicto llega verificado y los puntajes NO se guardan. Derivar de esa
   * ausencia un «no pasó la prueba de vida» —que es lo que hacía la primera versión de este
   * servicio— rechazaba a una clienta que el proveedor sí había verificado, por un campo vacío.
   *
   * La regla: si el puntaje está, manda el puntaje. Si no está pero el veredicto es `verified`, se
   * atestigua un aprobado CONSERVADOR y queda marcado como `derivado`, no como dato del expediente:
   * un veredicto verificado significa que los umbrales del proveedor se cumplieron, y eso es lo
   * único que Atlas puede afirmar. Si no hay ni veredicto ni puntaje, no se afirma nada.
   */
  private async identitySignals(
    tenantId: string,
    customerId: string,
  ): Promise<{ verified: boolean; liveness: boolean; matchScore: number; confidence: number; inferred: boolean }> {
    const attempt = await this.identityAttempts.findOne({
      where: { tenantId, customerId },
      order: [['_id', 'DESC']],
    } as FindOptions);

    if (!attempt) return { verified: false, liveness: false, matchScore: 0, confidence: 0, inferred: false };
    const verified = attempt.finalResult === 'verified';

    // Los puntajes del proveedor llegan en 0..1; el artefacto los espera en 0..100.
    const liveness = toNumber(attempt.livenessScore);
    const selfie = clamp(Math.round(toNumber(attempt.selfieMatchScore) * 100), 0, 100);
    const name = clamp(Math.round(toNumber(attempt.nameMatchScore) * 100), 0, 100);
    const hasScores = liveness > 0 || selfie > 0 || name > 0;

    if (hasScores) {
      return { verified, liveness: liveness > 0, matchScore: selfie, confidence: name, inferred: false };
    }

    /*
     * Sin desglose. Se atestigua el aprobado del proveedor con el valor mínimo que la política
     * considera aprobado (70) y no con uno alto: Atlas no puede afirmar que la coincidencia fue
     * excelente, solo que fue suficiente para quien la midió.
     */
    return {
      verified,
      liveness: verified,
      matchScore: verified ? ATTESTED_PASS : 0,
      confidence: verified ? ATTESTED_PASS : 0,
      inferred: verified,
    };
  }

  /**
   * El historial de pago del cliente DENTRO de Atlas.
   *
   * Es lo único que se sabe con certeza sobre cómo paga, y por eso pesa: sustituye a un buró que
   * aquí no existe. El peor tramo de mora y el número de moras en doce meses son entradas directas
   * del artefacto, y son las que hacen que entrar en mora cueste puntaje.
   */
  private async creditHistory(
    tenantId: string,
    customerId: string,
    now: Date,
  ): Promise<{
    loanCount: number;
    delinquencyCount12m: number;
    worstStatus: string;
    chargeOffCount: number;
    oldestTradeAgeMonths: number;
    utilization: number;
    paymentHistoryScore: number;
    monthlyCommitted: number;
    applications6m: number;
    applications24h: number;
  }> {
    const loans = await this.loans.findAll({ where: { tenantId, customerId } } as FindOptions);
    if (loans.length === 0) {
      return {
        loanCount: 0,
        delinquencyCount12m: 0,
        worstStatus: 'CURRENT',
        chargeOffCount: 0,
        oldestTradeAgeMonths: 0,
        utilization: 0,
        // Sin historial NO se parte de cero: cero es «paga fatal», y quien no ha pedido nunca no
        // paga fatal, simplemente no ha pagado. Se parte de un valor medio y la política decide.
        paymentHistoryScore: 50,
        monthlyCommitted: 0,
        applications6m: 0,
        applications24h: 0,
      };
    }

    const schedule = await this.installments.findAll({
      where: { tenantId, loanId: { [Op.in]: loans.map((loan) => String(loan.id)) } },
    } as FindOptions);

    const today = now.toISOString().slice(0, 10);
    const yearAgo = new Date(now.getTime() - 365 * 86_400_000).toISOString().slice(0, 10);

    let overdueInLastYear = 0;
    let worstDaysLate = 0;
    let settledOnTime = 0;
    let settledLate = 0;
    let pendingMonthly = 0;

    for (const instalment of schedule) {
      const paid = instalment.status === 'paid';
      const late = instalment.dueDate < today && !paid;

      if (late && instalment.dueDate >= yearAgo) overdueInLastYear += 1;
      if (late) {
        const days = Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${instalment.dueDate}T00:00:00Z`)) / 86_400_000);
        worstDaysLate = Math.max(worstDaysLate, days);
      }
      if (paid) {
        if (toNumber(instalment.daysPastDue) > 0) settledLate += 1;
        else settledOnTime += 1;
      }
      if (!paid) pendingMonthly += toNumber(instalment.principalAmount) + toNumber(instalment.interestAmount);
    }

    const worstBucket = loans
      .map((loan) => String(loan.delinquencyBucket ?? 'current'))
      .sort()
      .reverse()[0];

    const settled = settledOnTime + settledLate;
    const paymentHistoryScore = settled > 0 ? clamp(Math.round((settledOnTime / settled) * 100), 0, 100) : 50;

    const disbursedDates = loans.map((loan) => loan.disbursedAt).filter((date): date is Date => Boolean(date));
    const oldest = disbursedDates.length > 0 ? Math.min(...disbursedDates.map((date) => new Date(date).getTime())) : now.getTime();

    return {
      loanCount: loans.length,
      delinquencyCount12m: overdueInLastYear,
      worstStatus: this.worstStatusOf(worstDaysLate, worstBucket),
      chargeOffCount: loans.filter((loan) => loan.status === 'written_off').length,
      oldestTradeAgeMonths: Math.max(0, Math.floor((now.getTime() - oldest) / (30.44 * 86_400_000))),
      utilization: 0,
      paymentHistoryScore,
      // El compromiso mensual pendiente entra en la relación deuda-ingreso: quien ya tiene tres
      // cuotas corriendo no dispone del mismo sueldo que quien no tiene ninguna.
      monthlyCommitted: Math.round((pendingMonthly / Math.max(1, loans.length * 3)) * 100) / 100,
      applications6m: loans.length,
      applications24h: loans.filter((loan) => loan.disbursedAt && now.getTime() - new Date(loan.disbursedAt).getTime() < 86_400_000).length,
    };
  }

  /** El peor tramo, medido contra el calendario y contrastado con el que dejó el barrido. */
  private worstStatusOf(worstDaysLate: number, bucket: string | undefined): string {
    if (worstDaysLate >= 120) return 'DPD_120_PLUS';
    if (worstDaysLate >= 90) return 'DPD_90';
    if (worstDaysLate >= 60) return 'DPD_60';
    if (worstDaysLate >= 1) return 'DPD_30';
    return DELINQUENCY_MAP[String(bucket ?? 'current').toLowerCase()] ?? 'CURRENT';
  }
}
