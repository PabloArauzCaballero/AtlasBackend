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

export const ELIGIBILITY_RULE_VERSION = 'eligibility-v1';

/** Códigos de bloqueo. Son parte del contrato con el frontend: no se renombran sin versionar. */
export const ELIGIBILITY_BLOCKER_CODES = [
  'ACCOUNT_NOT_ACTIVE',
  'NO_CREDENTIALS',
  'CONTACT_NOT_VERIFIED',
  'PROFILE_INCOMPLETE',
  'FINANCIAL_PROFILE_INCOMPLETE',
  'ADDRESS_MISSING',
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
export const ONBOARDING_SECTION_CODES = [
  'contact_verification',
  'personal_data',
  'financial_profile',
  'address',
  'identity_documents',
  'reference_contacts',
] as const;

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
  'monthly_expenses_declared',
  'economic_activity_code',
  'source_of_funds',
] as const;

/** Atributos económicos opcionales aceptados por el endpoint (no bloquean la habilitación). */
export const OPTIONAL_FINANCIAL_ATTRIBUTE_CODES = ['employer_name', 'other_monthly_income'] as const;

export const FINANCIAL_ATTRIBUTE_CODES = [...REQUIRED_FINANCIAL_ATTRIBUTE_CODES, ...OPTIONAL_FINANCIAL_ATTRIBUTE_CODES] as const;

export type FinancialAttributeCode = (typeof FINANCIAL_ATTRIBUTE_CODES)[number];

/** Catálogos cerrados de los atributos económicos categóricos. */
export const EMPLOYMENT_STATUS_VALUES = ['employee', 'self_employed', 'business_owner', 'retired', 'student', 'unemployed'] as const;
export const SOURCE_OF_FUNDS_VALUES = ['salary', 'business_income', 'rental_income', 'pension', 'remittances', 'savings', 'other'] as const;

/** Cantidad mínima de referencias personales. Ver decisión D-6. */
export const REQUIRED_REFERENCE_CONTACTS = 2;
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
