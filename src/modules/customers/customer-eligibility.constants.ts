/**
 * Regla técnica de habilitación crediticia y catálogo de secciones del onboarding.
 *
 * La habilitación NO se guarda como una bandera que cualquier servicio pueda escribir: se CALCULA a
 * partir de condiciones verificables y cada cálculo deja evidencia en
 * `customer_eligibility_evaluations`. Esa es la diferencia entre poder responder "este cliente fue
 * habilitado porque cumplía A, B y C el día X con la regla vX" y tener que reconstruirlo a mano.
 *
 * `ELIGIBILITY_RULE_VERSION` se persiste con cada evaluación: cambiar un requisito obliga a subir la
 * versión, y las evaluaciones históricas siguen explicando por qué se decidió lo que se decidió.
 */

/*
 * v2 (2026-09-28): el alta pide sólo los quince datos que fijó el dueño. Salen de lo obligatorio las
 * referencias personales, la encuesta de consumo, los gastos mensuales y el origen de fondos. Las
 * evaluaciones hechas con v1 siguen explicando lo que decidieron con su regla.
 */
export const ELIGIBILITY_RULE_VERSION = 'eligibility-v2';

/** Códigos de bloqueo. Son parte del contrato con el frontend: no se renombran sin versionar. */
export const ELIGIBILITY_BLOCKER_CODES = [
  'ACCOUNT_NOT_ACTIVE',
  'NO_CREDENTIALS',
  'CONTACT_NOT_VERIFIED',
  'PROFILE_INCOMPLETE',
  'FINANCIAL_PROFILE_INCOMPLETE',
  'ADDRESS_MISSING',
  /** Histórico (eligibility-v1): desde v2 las referencias no bloquean. Se conserva por contrato. */
  'REFERENCES_INSUFFICIENT',
  'IDENTITY_DOCUMENT_MISSING',
  'IDENTITY_DOCUMENT_EXPIRED',
  'IDENTITY_NOT_VERIFIED',
  'EVIDENCE_PENDING_REVIEW',
  'CONSENT_MISSING',
  'OPEN_OBSERVATIONS',
  'COMPLIANCE_MATCH_PENDING',
  'RISK_NOT_APPROVED',
  'RISK_ASSESSMENT_STALE',
  'FRAUD_CASE_OPEN',
] as const;

export type EligibilityBlockerCode = (typeof ELIGIBILITY_BLOCKER_CODES)[number];

/**
 * Secciones del onboarding. El orden define el `nextStep` que consume el frontend: se devuelve la
 * primera sección no completada. Es el ÚNICO lugar donde se decide dónde retomar el proceso — antes
 * había cuatro cálculos distintos de `nextStep` en cuatro módulos, con resultados incompatibles.
 */
/*
 * El orden es el de las FASES del alta: contacto → identidad (el carnet ANTES que los datos
 * personales: el OCR prellena y la persona confirma) → situación (domicilio, economía y los permisos
 * del teléfono, que dejaron de pedirse al arrancar la app). `device_permissions` se completa con una
 * DECISIÓN, incluida la negativa.
 *
 * Desde eligibility-v2 (2026-09-28) `reference_contacts` y `consumer_survey` ya NO son secciones: el
 * alta pide sólo quince datos. Sus rutas siguen vivas para las apps viejas, pero no bloquean ni
 * cuentan para el porcentaje (ver `RETIRED_ONBOARDING_SECTION_CODES`).
 */
export const ONBOARDING_SECTION_CODES = [
  'contact_verification',
  'identity_documents',
  'personal_data',
  'address',
  'financial_profile',
  'device_permissions',
] as const;

/**
 * Secciones que existieron (eligibility-v1) y ya no se exigen. Una etapa del catálogo de procesos que
 * todavía las nombre se informa como «no aplica», no como pendiente para siempre.
 */
export const RETIRED_ONBOARDING_SECTION_CODES = ['reference_contacts', 'consumer_survey'] as const;

/** Las finalidades cuya decisión (sí o no) cierra la sección `device_permissions`. Son los códigos que siembra `privacy`. */
export const DEVICE_PERMISSION_PURPOSE_CODES = ['device_address_book', 'location_tracking'] as const;

export type OnboardingSectionCode = (typeof ONBOARDING_SECTION_CODES)[number];

export type OnboardingSectionStatus = 'pending' | 'in_progress' | 'completed';

/**
 * Campos obligatorios del perfil personal.
 *
 * Antes eran TODOS opcionales (`customer-onboarding.schemas.ts` los declaraba `.optional()`), de
 * modo que no existía la noción de "perfil completo" en ninguna parte del sistema.
 */
export const REQUIRED_PROFILE_FIELDS = ['firstName', 'lastName', 'birthDate'] as const;

/** Edad mínima para operar. Ver decisión D-2 del análisis funcional. */
export const MINIMUM_CUSTOMER_AGE_YEARS = 18;
/** Edad máxima aceptada; por encima se exige revisión manual, no se rechaza automáticamente. */
export const MAXIMUM_CUSTOMER_AGE_YEARS = 100;

/**
 * Atributos económicos obligatorios, resueltos contra `attribute_definitions.attribute_code`.
 *
 * Se persisten en `customer_attribute_values`, que ya existía migrada y sin un solo uso en el
 * código. Se reutiliza en vez de agregar columnas nuevas: la tabla es EAV versionada
 * (`valid_from`/`valid_until`, `source_type`, `verification_status`, `evidence_id`), justo lo que
 * hace falta para distinguir "declarado por el cliente" de "verificado contra evidencia".
 */
export const REQUIRED_FINANCIAL_ATTRIBUTE_CODES = [
  'employment_status',
  'employment_seniority_months',
  'monthly_income_declared',
  'economic_activity_code',
] as const;

/**
 * Atributos económicos opcionales aceptados por el endpoint (no bloquean la habilitación).
 *
 * `monthly_expenses_declared` y `source_of_funds` fueron obligatorios hasta eligibility-v1; la app ya
 * no los pide. Quien los consume (la suscripción del Motor) los trata como AUSENTES, nunca como cero.
 */
export const OPTIONAL_FINANCIAL_ATTRIBUTE_CODES = [
  'employer_name',
  'other_monthly_income',
  'monthly_income_band',
  'income_frequency',
  'monthly_expenses_declared',
  'source_of_funds',
  'economic_activity_other',
] as const;

export const FINANCIAL_ATTRIBUTE_CODES = [...REQUIRED_FINANCIAL_ATTRIBUTE_CODES, ...OPTIONAL_FINANCIAL_ATTRIBUTE_CODES] as const;

export type FinancialAttributeCode = (typeof FINANCIAL_ATTRIBUTE_CODES)[number];

/** Catálogos cerrados de los atributos económicos categóricos. */
export const EMPLOYMENT_STATUS_VALUES = ['employee', 'self_employed', 'business_owner', 'retired', 'student', 'unemployed'] as const;
/**
 * Bandas del ingreso mensual autodeclarado (Bs). El alta pide la banda, no el monto: es un dato
 * blando, y la app manda además `monthlyIncomeDeclared` con el valor conservador de la banda para que
 * la capacidad sin extracto (`CAP_SIN_EXTRACTO`) siga teniendo un número.
 */
export const MONTHLY_INCOME_BAND_VALUES = [
  'bs_0_3000',
  'bs_3000_5000',
  'bs_5000_8000',
  'bs_8000_12000',
  'bs_12000_20000',
  'bs_20000_plus',
] as const;
/** Con qué frecuencia cobra: sirve para alinear las fechas de pago con su día de cobro. */
export const INCOME_FREQUENCY_VALUES = ['monthly', 'biweekly', 'weekly', 'irregular'] as const;
export const SOURCE_OF_FUNDS_VALUES = ['salary', 'business_income', 'rental_income', 'pension', 'remittances', 'savings', 'other'] as const;

/** Tope de referencias personales que se aceptan. Desde eligibility-v2 no hay mínimo: son opcionales. */
export const MAXIMUM_REFERENCE_CONTACTS = 5;

/**
 * Vigencia de una evaluación de riesgo. Pasado este plazo la evaluación se considera obsoleta y la
 * habilitación se bloquea con `RISK_ASSESSMENT_STALE` hasta que se recalcule. Ver decisión D-11.
 */
export const RISK_ASSESSMENT_TTL_DAYS = 90;

/** Decisión de riesgo que la regla de habilitación considera favorable. */
export const RISK_APPROVED_ACTION = 'approved_for_next_step';

/** Resultado de verificación de identidad que la regla considera suficiente. */
export const IDENTITY_VERIFIED_RESULT = 'verified';
