/**
 * @file La forma de lo que entra y sale del cálculo de capacidad de pago.
 * @business Nombra qué se mide del cliente y qué se le responde, con la razón de cada corte.
 * @system tipos puros del dominio de capacidad de pago.
 */

/**
 * Viven aparte para romper un ciclo: `relationship-score.ts` necesita `RelationshipInput` y
 * `payment-capacity.ts` necesita las tres funciones de aquél. Un archivo de tipos, sin imports, no
 * puede formar ciclo con nadie.
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
