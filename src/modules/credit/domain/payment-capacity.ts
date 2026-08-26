/**
 * @file Utilidad pura o acotada reutilizable dentro de su capa.
 * @business Esta pieza propone cuánto crédito soporta esta persona, y deja escrito de dónde sale cada boliviano.
 * @system combina la capacidad del extracto con la relación del cliente con la plataforma, sin tocar base de datos.
 */

/**
 * Cuánto deberíamos aprobarle, y por qué esa cifra.
 *
 * ## La pregunta que faltaba
 *
 * El motor respondía «sí o no». Eso decide si alguien entra, y no decide lo único que después
 * importa todos los días: **cuánto**. Sin una respuesta a esa segunda pregunta el límite salía de
 * una constante —eran Bs 5.000 escritos en el código de la app, el mismo número para todo el
 * mundo— o del artefacto sin más contexto que el expediente declarado.
 *
 * ## Las dos mitades, y por qué ninguna basta sola
 *
 * 1. **Lo que el EXTRACTO soporta.** Es la única evidencia de cuánto puede pagar al mes: ingreso
 *    reconocido menos lo que ya está comprometido, tensionado por su volatilidad. Sale del worker
 *    de extractos del motor, que exige tres meses completos.
 * 2. **Lo que la RELACIÓN merece.** Antigüedad en la plataforma, historial de pago dentro de Atlas
 *    y fidelización. No mide capacidad: mide confianza ganada.
 *
 * Con sólo la primera, un cliente que entró ayer con un extracto excelente recibiría el límite
 * máximo el primer día —y el fraude de primera compra es el riesgo más caro del crédito al
 * consumo—. Con sólo la segunda, un cliente antiguo y cumplidor recibiría un límite que su ingreso
 * de hoy no sostiene, que es cómo se construye una cartera que se cae cuando cambia el ciclo.
 *
 * **Manda la MENOR de las dos.** La capacidad es un techo físico y la relación es un techo de
 * confianza; superar cualquiera de los dos es prestar contra algo que no existe.
 *
 * ## Por qué esto PROPONE y no decide
 *
 * Porque el límite lo emite la política del motor, versionada, aprobada y auditable —es la regla
 * que sostiene todo el producto y no puede vivir en el core—. Lo que sale de aquí viaja al
 * artefacto como una variable más, y se guarda junto al límite que el artefacto devolvió. Que las
 * dos cifras estén escritas es lo que permite responder «¿la política se apartó de la capacidad
 * medida, y cuánto?», que es la pregunta con la que se calibra un modelo de crédito.
 */

/** Lo que el extracto demostró. Todo `null` cuando el cliente no subió ninguno. */
export interface StatementCapacityInput {
  /** Si la evaluación del motor es utilizable: tres meses completos y legibles. */
  readonly eligible: boolean;
  readonly maxAffordableInstallment: number | null;
  readonly monthlyIncome: number | null;
  readonly monthlyObligations: number | null;
  readonly stabilityScore: number | null;
  readonly affordabilityScore: number | null;
  readonly band: string | null;
  readonly monthsComplete: number | null;
}

/** Lo que la relación con la plataforma demostró. */
export interface RelationshipInput {
  /** Meses desde el alta del cliente. */
  readonly tenureMonths: number;
  /** Créditos ya cerrados sin castigo. Es la prueba más fuerte de fidelización. */
  readonly loansSettled: number;
  readonly loansActive: number;
  /** Proporción de cuotas pagadas a tiempo sobre las vencidas. `null` sin historial. */
  readonly onTimeRatio: number | null;
  readonly worstDaysPastDue: number;
  readonly chargeOffCount: number;
  readonly delinquencyCount12m: number;
  /** Meses desde el último crédito. Alto = relación dormida. `null` si nunca hubo. */
  readonly monthsSinceLastLoan: number | null;
  /** Identidad verificada, domicilio y contacto confirmados. */
  readonly kycComplete: boolean;
  /** Casos de fraude o alertas abiertas. Cualquiera corta la escalera. */
  readonly fraudFlags: number;
}

export interface PaymentCapacityPolicy {
  /** Plazo con el que se convierte una cuota mensual en un límite. */
  readonly termMonths: number;
  /** Techo del producto. Ninguna combinación lo supera. */
  readonly productCeiling: number;
  /** Lo máximo para quien no tiene ninguna relación todavía. */
  readonly starterCap: number;
  /** Cuánto puede subir un límite respecto del anterior en un solo recálculo. */
  readonly graduationFactor: number;
  /** Lo mínimo que tiene sentido conceder; por debajo, mejor no conceder. */
  readonly minimumUsefulLimit: number;
  /**
   * Lo máximo que se propone SIN extracto, sobre el ingreso declarado.
   *
   * Existe para que un cliente sin extracto no se quede en cero —eso convertiría el extracto en un
   * requisito de facto— y es deliberadamente pequeño: lo declarado no es evidencia.
   */
  readonly declaredIncomeShare: number;
}

export const DEFAULT_CAPACITY_POLICY: PaymentCapacityPolicy = {
  termMonths: 3,
  productCeiling: 20_000,
  starterCap: 1_500,
  graduationFactor: 2,
  minimumUsefulLimit: 300,
  declaredIncomeShare: 0.1,
};

export interface CapacityReason {
  readonly code: string;
  readonly message: string;
  readonly evidence?: string;
}

export interface PaymentCapacityAssessment {
  /** La propuesta, en la moneda del producto. */
  readonly recommendedLimit: number;
  /** Cuota mensual con la que se calculó. */
  readonly monthlyInstallment: number;
  /** Qué techo mordió primero. Es la respuesta a «¿por qué no más?». */
  readonly bindingConstraint: 'CAPACIDAD' | 'RELACION' | 'GRADUACION' | 'PRODUCTO' | 'SIN_CAPACIDAD';
  /** 0..100. Confianza ganada con la plataforma. */
  readonly relationshipScore: number;
  readonly relationshipTier: 'NUEVO' | 'EN_CONSTRUCCION' | 'ESTABLECIDO' | 'CONSOLIDADO' | 'PREFERENTE';
  /** Los cuatro techos, para poder auditar la resta. */
  readonly ceilings: {
    readonly byCapacity: number | null;
    readonly byRelationship: number;
    readonly byGraduation: number | null;
    readonly product: number;
  };
  readonly components: {
    readonly tenure: number;
    readonly paymentHistory: number;
    readonly loyalty: number;
    readonly verification: number;
  };
  /** Si la propuesta se apoya en un extracto o en lo declarado. */
  readonly evidence: 'EXTRACTO' | 'DECLARADO';
  readonly reasons: readonly CapacityReason[];
  readonly modelVersion: string;
}

/**
 * Versión del modelo. Viaja con cada propuesta.
 *
 * Sin ella, un límite propuesto hace tres meses y otro de hoy son dos cifras que no se pueden
 * comparar: no habría forma de saber si la diferencia la produjo el cliente o un cambio en la
 * fórmula.
 */
export const CAPACITY_MODEL_VERSION = '1.0.0';

/** La escalera de confianza. Cada tramo multiplica el techo de quien empieza. */
const TIERS: ReadonlyArray<{
  from: number;
  tier: PaymentCapacityAssessment['relationshipTier'];
  multiplier: number;
}> = [
  { from: 85, tier: 'PREFERENTE', multiplier: 6 },
  { from: 70, tier: 'CONSOLIDADO', multiplier: 4 },
  { from: 50, tier: 'ESTABLECIDO', multiplier: 2.5 },
  { from: 25, tier: 'EN_CONSTRUCCION', multiplier: 1.5 },
  { from: 0, tier: 'NUEVO', multiplier: 1 },
];

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value));
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * La antigüedad, en puntos.
 *
 * Satura a los doce meses y no crece más: el primer año es donde la antigüedad discrimina de verdad
 * —quien lleva un mes y quien lleva un año no se parecen en nada— y a partir de ahí lo que
 * distingue a un cliente de otro es cómo paga, no cuánto lleva. Dejarla crecer indefinidamente
 * premiaría la inercia por encima del comportamiento.
 */
function tenureScore(tenureMonths: number): number {
  return Math.round(clamp(tenureMonths / 12, 0, 1) * 100);
}

/**
 * El historial de pago DENTRO de Atlas, en puntos.
 *
 * Sin historial se parte de 50 y no de 0: cero significa «paga fatal», y quien no ha pedido nunca no
 * paga fatal — simplemente no ha pagado. Confundir las dos cosas le niega crédito a quien nunca lo
 * pidió, que es el error que este producto existe para no cometer.
 *
 * Los castigos son duros y acumulativos porque son la señal más predictiva que hay: un castigo de
 * cartera pesa más que cualquier cosa buena que se pueda decir del cliente.
 */
function paymentHistoryScore(input: RelationshipInput): number {
  if (input.onTimeRatio === null && input.loansSettled === 0 && input.loansActive === 0) return 50;

  const base = (input.onTimeRatio ?? 0.5) * 100;
  const dpdPenalty = input.worstDaysPastDue >= 90 ? 60 : input.worstDaysPastDue >= 30 ? 30 : input.worstDaysPastDue >= 1 ? 10 : 0;
  const chargeOffPenalty = input.chargeOffCount > 0 ? 70 : 0;
  const recentPenalty = Math.min(30, input.delinquencyCount12m * 10);

  return Math.round(clamp(base - dpdPenalty - chargeOffPenalty - recentPenalty, 0, 100));
}

/**
 * La fidelización, en puntos.
 *
 * No es «cuánto ha usado el producto» sino «cuántas veces ha completado el ciclo»: un crédito
 * cerrado sin castigo es la prueba de que la relación funciona en las dos direcciones. Los créditos
 * vivos suman menos que los cerrados —todavía no han terminado— y la relación dormida descuenta,
 * porque un cliente que no vuelve en un año no es un cliente fiel: es uno que se fue.
 */
function loyaltyScore(input: RelationshipInput): number {
  const settled = Math.min(60, input.loansSettled * 20);
  const active = Math.min(20, input.loansActive * 10);
  const recency = input.monthsSinceLastLoan === null ? 0 : Math.round(clamp(1 - input.monthsSinceLastLoan / 12, 0, 1) * 20);
  return Math.round(clamp(settled + active + recency, 0, 100));
}

/**
 * Propone cuánto conceder.
 *
 * NO decide: lo que devuelve viaja al artefacto como una variable más y se guarda junto al límite
 * que el artefacto emitió.
 */
export function assessPaymentCapacity(input: {
  statement: StatementCapacityInput;
  relationship: RelationshipInput;
  /** Ingreso declarado en el alta. Sólo se usa cuando no hay extracto utilizable. */
  declaredMonthlyIncome: number | null;
  /** Límite vigente, para que la subida sea escalonada. `null` en el primer cálculo. */
  currentLimit: number | null;
  policy?: Partial<PaymentCapacityPolicy>;
}): PaymentCapacityAssessment {
  const policy = { ...DEFAULT_CAPACITY_POLICY, ...input.policy };
  const reasons: CapacityReason[] = [];
  const add = (code: string, message: string, evidence?: string) => reasons.push({ code, message, evidence });

  const components = {
    tenure: tenureScore(input.relationship.tenureMonths),
    paymentHistory: paymentHistoryScore(input.relationship),
    loyalty: loyaltyScore(input.relationship),
    verification: input.relationship.kycComplete ? 100 : 0,
  };

  /*
   * El historial de pago pesa el doble que la antigüedad, y es la decisión de reparto que importa:
   * llevar tiempo no es lo mismo que cumplir. Un cliente de dos años que paga tarde vale menos que
   * uno de seis meses que paga a tiempo, y con pesos iguales saldría al revés.
   */
  let relationshipScore = Math.round(
    components.tenure * 0.2 + components.paymentHistory * 0.45 + components.loyalty * 0.25 + components.verification * 0.1,
  );

  /*
   * Una alerta de fraude no descuenta puntos: BAJA al suelo. Es la única señal de esta función que
   * no se compensa con nada, porque lo que afirma no es «este cliente es peor» sino «no sabemos si
   * este cliente es quien dice ser», y sobre esa duda no se escala ningún límite.
   */
  if (input.relationship.fraudFlags > 0) {
    relationshipScore = Math.min(relationshipScore, 10);
    add(
      'CAP_ALERTA_DE_FRAUDE',
      'Hay una alerta de fraude abierta sobre la cuenta: el límite no escala mientras siga abierta.',
      `${String(input.relationship.fraudFlags)} alerta(s)`,
    );
  }

  /*
   * Ningún tramo por encima de NUEVO sin evidencia de relación.
   *
   * Sin este corte, un cliente que se dio de alta hoy con la identidad verificada salía con 33
   * puntos —el historial neutro de 50 más la verificación— y subía un escalón el primer día. El
   * puntaje neutro está para no CASTIGAR a quien no ha pedido nunca; usarlo para PREMIARLE
   * convierte la ausencia de historial en historial bueno, que es la lectura contraria.
   *
   * La escalera mide confianza GANADA, y sólo se gana de dos formas: con tiempo o con un crédito
   * devuelto. Basta una de las dos.
   */
  const haGanadoRelacion = input.relationship.tenureMonths >= 3 || input.relationship.loansSettled > 0;
  if (!haGanadoRelacion) {
    relationshipScore = Math.min(relationshipScore, 24);
    add(
      'CAP_RELACION_NUEVA',
      'Todavía no hay historia con la plataforma. El límite empieza en el tramo inicial y sube con cada crédito que pagas a tiempo.',
      `${String(input.relationship.tenureMonths)} mes(es) de antigüedad`,
    );
  }

  const tier = TIERS.find((step) => relationshipScore >= step.from) ?? TIERS[TIERS.length - 1]!;
  const byRelationship = round2(policy.starterCap * tier.multiplier);

  // ------------------------------------------------------------------ capacidad
  let byCapacity: number | null = null;
  let monthlyInstallment = 0;
  let evidence: PaymentCapacityAssessment['evidence'] = 'DECLARADO';

  if (input.statement.eligible && (input.statement.maxAffordableInstallment ?? 0) > 0) {
    evidence = 'EXTRACTO';
    monthlyInstallment = input.statement.maxAffordableInstallment ?? 0;
    byCapacity = round2(monthlyInstallment * policy.termMonths);
    add(
      'CAP_EXTRACTO',
      'La capacidad se calculó con los movimientos reales de la cuenta, sobre tres meses completos.',
      `cuota máxima ${monthlyInstallment.toFixed(2)} × ${String(policy.termMonths)} meses`,
    );
  } else if ((input.declaredMonthlyIncome ?? 0) > 0) {
    /*
     * Sin extracto se usa lo DECLARADO con una participación pequeña, y queda marcado como tal. Es
     * la decisión incómoda de esta función: dejarlo en cero convertiría el extracto en un requisito
     * de facto —y en Bolivia mucha gente no tiene banca por internet— mientras que tratarlo como
     * evidencia premiaría a quien escribe el número más alto en el formulario.
     */
    monthlyInstallment = round2((input.declaredMonthlyIncome ?? 0) * policy.declaredIncomeShare);
    byCapacity = round2(monthlyInstallment * policy.termMonths);
    add(
      'CAP_SIN_EXTRACTO',
      'Todavía no hay un extracto bancario utilizable, así que la propuesta se apoya en el ingreso declarado y es conservadora.',
      input.statement.monthsComplete === null
        ? undefined
        : `el extracto cubría ${String(input.statement.monthsComplete)} mes(es) completo(s) y se exigen 3`,
    );
  } else {
    add('CAP_SIN_EVIDENCIA', 'No hay extracto ni ingreso declarado: no se puede proponer ningún límite.');
  }

  // ------------------------------------------------------------------ graduación
  const byGraduation = input.currentLimit !== null && input.currentLimit > 0 ? round2(input.currentLimit * policy.graduationFactor) : null;

  const candidates: Array<{ limit: number; constraint: PaymentCapacityAssessment['bindingConstraint'] }> = [
    { limit: byRelationship, constraint: 'RELACION' },
    { limit: policy.productCeiling, constraint: 'PRODUCTO' },
  ];
  if (byCapacity !== null) candidates.push({ limit: byCapacity, constraint: 'CAPACIDAD' });
  if (byGraduation !== null) candidates.push({ limit: byGraduation, constraint: 'GRADUACION' });

  const binding = candidates.reduce((lowest, candidate) => (candidate.limit < lowest.limit ? candidate : lowest));
  const proposed = byCapacity === null ? 0 : Math.max(0, binding.limit);
  const recommendedLimit = proposed < policy.minimumUsefulLimit ? 0 : round2(proposed);

  if (recommendedLimit === 0 && byCapacity !== null) {
    add(
      'CAP_POR_DEBAJO_DEL_MINIMO',
      `La capacidad medida no llega al mínimo útil del producto (${String(policy.minimumUsefulLimit)}).`,
      `propuesto ${proposed.toFixed(2)}`,
    );
  }
  if (binding.constraint === 'RELACION' && recommendedLimit > 0) {
    add(
      'CAP_ESCALERA_DE_RELACION',
      'El extracto soporta más de lo que la relación con la plataforma permite todavía. Cada crédito pagado a tiempo sube el tramo.',
      `tramo ${tier.tier} · ${String(relationshipScore)}/100`,
    );
  }
  if (binding.constraint === 'GRADUACION' && recommendedLimit > 0) {
    add(
      'CAP_SUBIDA_ESCALONADA',
      'El límite sube por pasos: como mucho el doble del vigente en cada recálculo.',
      `vigente ${String(input.currentLimit ?? 0)}`,
    );
  }
  if (input.relationship.chargeOffCount > 0) {
    add(
      'CAP_CREDITO_CASTIGADO',
      'Hay un crédito castigado en el historial, y eso pesa más que cualquier otra señal.',
      `${String(input.relationship.chargeOffCount)} castigo(s)`,
    );
  }

  return {
    recommendedLimit,
    monthlyInstallment: round2(monthlyInstallment),
    bindingConstraint: byCapacity === null ? 'SIN_CAPACIDAD' : binding.constraint,
    relationshipScore,
    relationshipTier: tier.tier,
    ceilings: {
      byCapacity,
      byRelationship,
      byGraduation,
      product: policy.productCeiling,
    },
    components,
    evidence,
    reasons,
    modelVersion: CAPACITY_MODEL_VERSION,
  };
}
