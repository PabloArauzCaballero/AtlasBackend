/**
 * @file Artefacto de soporte específico de esta carpeta.
 * @business Esta pieza mantiene la identidad operativa, ciclo de vida y elegibilidad del cliente como fuente de verdad.
 * @system expone casos de uso de cliente, evaluación de condiciones y transiciones de estado persistidas.
 */
import {
  DEVICE_PERMISSION_PURPOSE_CODES,
  ELIGIBILITY_RULE_VERSION,
  EligibilityBlockerCode,
  MAXIMUM_CUSTOMER_AGE_YEARS,
  MINIMUM_CUSTOMER_AGE_YEARS,
  OnboardingSectionCode,
  OnboardingSectionStatus,
  REQUIRED_FINANCIAL_ATTRIBUTE_CODES,
  REQUIRED_PROFILE_FIELDS,
  REQUIRED_REFERENCE_CONTACTS,
  RISK_APPROVED_ACTION,
  RISK_ASSESSMENT_TTL_DAYS,
} from '../customer-eligibility.constants.js';
import { isIdentityVerified } from '../../../common/utils/identity/identity-result.util.js';
import { CREDIT_ELIGIBLE_STATUS, CustomerLifecycleStatus } from '../customer-lifecycle.constants.js';
import type { EligibilityFacts } from '../repositories/customer-eligibility.facts.js';
import { CODIGOS_DE_PREGUNTA } from '../consumer-survey.catalog.js';

export type EligibilityBlocker = {
  code: EligibilityBlockerCode;
  fields?: string[];
  detail?: string;
};

export type OnboardingSection = {
  code: OnboardingSectionCode;
  status: OnboardingSectionStatus;
  missingFields: string[];
};

export type EligibilityAssessment = {
  eligible: boolean;
  lifecycleStatus: CustomerLifecycleStatus;
  ruleVersion: string;
  sections: OnboardingSection[];
  completionPercentage: number;
  canSubmit: boolean;
  nextStep: OnboardingSectionCode | 'awaiting_review' | 'resolve_observations' | 'complete' | 'blocked';
  blockers: EligibilityBlocker[];
};

const DAY_MS = 24 * 60 * 60 * 1000;

export function calculateAgeInYears(birthDate: string, reference: Date): number {
  const birth = new Date(`${birthDate}T00:00:00.000Z`);
  if (Number.isNaN(birth.getTime())) return Number.NaN;
  let age = reference.getUTCFullYear() - birth.getUTCFullYear();
  const monthDelta = reference.getUTCMonth() - birth.getUTCMonth();
  if (monthDelta < 0 || (monthDelta === 0 && reference.getUTCDate() < birth.getUTCDate())) age -= 1;
  return age;
}

export function isAgeAcceptable(birthDate: string | null, reference: Date): boolean {
  if (!birthDate) return false;
  const age = calculateAgeInYears(birthDate, reference);
  return Number.isFinite(age) && age >= MINIMUM_CUSTOMER_AGE_YEARS && age <= MAXIMUM_CUSTOMER_AGE_YEARS;
}

function missingProfileFields(facts: EligibilityFacts, now: Date): string[] {
  const profile = facts.profile;
  const missing: string[] = [];
  if (!profile?.firstName) missing.push('firstName');
  if (!profile?.lastName) missing.push('lastName');
  if (!profile?.birthDate) missing.push('birthDate');
  else if (!isAgeAcceptable(profile.birthDate, now)) missing.push('birthDate');
  return missing.filter((field) => (REQUIRED_PROFILE_FIELDS as readonly string[]).includes(field));
}

/**
 * Situaciones laborales en las que la ANTIGÜEDAD tiene respuesta posible.
 *
 * Fuera de estas dos, preguntar «cuánto tiempo llevas en tu trabajo» no tiene sentido: quien declara
 * que no trabaja, que estudia o que está jubilado no tiene una antigüedad que contar, y quien trabaja
 * por su cuenta no la tiene contra ningún empleador. La app dejó de pedirla en esos casos, y esta
 * regla tenía que aprender lo mismo: si no, el expediente se queda en «en curso» para siempre
 * esperando un dato que ya nadie va a introducir — y la única salida era inventárselo.
 */
const EMPLOYMENT_STATUSES_WITH_SENIORITY: readonly string[] = ['employee', 'business_owner'];

function missingFinancialFields(facts: EligibilityFacts): string[] {
  const present = new Set(facts.presentFinancialAttributeCodes);
  // Lectura defensiva: hay bancos de prueba que arman los hechos sin este mapa.
  const employmentStatus = facts.financialAttributeTexts?.['employment_status'];
  /*
   * Mientras no se haya declarado la situación laboral, la antigüedad se sigue exigiendo: el hueco
   * existe hasta que se sepa si aplica, y quitarlo antes daría por completa una sección a la que
   * todavía le falta el dato que decide.
   */
  const senioritySkipped = employmentStatus !== undefined && !EMPLOYMENT_STATUSES_WITH_SENIORITY.includes(employmentStatus);

  return REQUIRED_FINANCIAL_ATTRIBUTE_CODES.filter((code) => {
    if (code === 'employment_seniority_months' && senioritySkipped) return false;
    return !present.has(code);
  });
}

function missingConsentDocumentIds(facts: EligibilityFacts): string[] {
  const granted = new Set(facts.grantedConsentDocumentIds);
  return facts.requiredConsentDocumentIds.filter((id) => !granted.has(id));
}

function isDocumentExpired(expiresAt: string | null | undefined, now: Date): boolean {
  if (!expiresAt) return false;
  const expiry = new Date(`${expiresAt}T23:59:59.999Z`);
  return !Number.isNaN(expiry.getTime()) && expiry.getTime() < now.getTime();
}

function isRiskStale(decidedAt: Date | null | undefined, now: Date): boolean {
  if (!decidedAt) return true;
  return now.getTime() - decidedAt.getTime() > RISK_ASSESSMENT_TTL_DAYS * DAY_MS;
}

function sectionStatus(missing: string[], touched: boolean): OnboardingSectionStatus {
  if (missing.length === 0) return 'completed';
  return touched ? 'in_progress' : 'pending';
}

/**
 * Secciones del onboarding con su estado y campos faltantes.
 *
 * Es la ÚNICA derivación de "dónde va el cliente". Antes existían cuatro cálculos incompatibles de
 * `nextStep` (`customers.mapper.ts`, `session-start.service.ts`, `risk.service.ts` y los valores
 * fijos de los servicios de paquete), y el de `customers.mapper.ts` ramificaba sobre estados que
 * ningún código escribía: un cliente en `pending_identity_review` recibía `identity_capture` y la
 * app le pedía volver a subir documentos que ya había enviado.
 */
export function buildSections(facts: EligibilityFacts, now: Date): OnboardingSection[] {
  const profileMissing = missingProfileFields(facts, now);
  const financialMissing = missingFinancialFields(facts);
  const identityMissing: string[] = [];
  if (!facts.identityDocument) identityMissing.push('identityDocument');
  else if (isDocumentExpired(facts.identityDocument.expiresAt, now)) identityMissing.push('documentExpiry');

  const referenceMissing = facts.referenceContactCount >= REQUIRED_REFERENCE_CONTACTS ? [] : ['referenceContacts'];
  // Lectura defensiva de los dos hechos nuevos: hay bancos de prueba que arman los hechos sin ellos.
  const decidedPurposes = new Set(facts.decidedDevicePermissionPurposes ?? []);
  const permissionsMissing = DEVICE_PERMISSION_PURPOSE_CODES.filter((purpose) => !decidedPurposes.has(purpose));
  const answered = new Set(facts.answeredSurveyQuestionCodes ?? []);
  const surveyMissing = CODIGOS_DE_PREGUNTA.filter((code) => !answered.has(code));

  /*
   * En el ORDEN de `ONBOARDING_SECTION_CODES`: el `nextStep` es la primera sección sin completar, y
   * ese orden es el de las cuatro fases del alta. El carnet va antes que los datos personales.
   */
  return [
    {
      code: 'contact_verification',
      status: facts.verifiedContactCount > 0 ? 'completed' : 'pending',
      missingFields: facts.verifiedContactCount > 0 ? [] : ['verifiedContact'],
    },
    {
      code: 'identity_documents',
      status: sectionStatus(identityMissing, facts.identityDocument !== null),
      missingFields: identityMissing,
    },
    {
      code: 'personal_data',
      status: sectionStatus(profileMissing, facts.profile !== null),
      missingFields: profileMissing,
    },
    {
      code: 'address',
      status: facts.hasCurrentAddress ? 'completed' : 'pending',
      missingFields: facts.hasCurrentAddress ? [] : ['address'],
    },
    {
      code: 'financial_profile',
      status: sectionStatus(financialMissing, facts.presentFinancialAttributeCodes.length > 0),
      missingFields: financialMissing,
    },
    {
      code: 'reference_contacts',
      status: sectionStatus(referenceMissing, facts.referenceContactCount > 0),
      missingFields: referenceMissing,
    },
    {
      // Una decisión —también «no»— cierra la sección. Lo que se exige es haber decidido.
      code: 'device_permissions',
      status: sectionStatus(permissionsMissing, decidedPurposes.size > 0),
      missingFields: permissionsMissing,
    },
    {
      code: 'consumer_survey',
      status: sectionStatus(surveyMissing, answered.size > 0),
      missingFields: surveyMissing,
    },
  ];
}

/**
 * Bloqueadores de la habilitación. Lista completa: nunca corta en el primero encontrado.
 *
 * El veredicto de identidad se lee con `isIdentityVerified` (`common/utils/identity`), que entiende
 * el vocabulario de los dos canales: el del Motor (`mobile-identity`) escribe `VERIFIED` y el del
 * operador y el proveedor escriben `verified`. Comparar en estricto dejaba a todo cliente verificado
 * por el Motor con `IDENTITY_NOT_VERIFIED` hasta que una persona lo firmara otra vez.
 */
export function buildBlockers(facts: EligibilityFacts, lifecycleStatus: CustomerLifecycleStatus, now: Date): EligibilityBlocker[] {
  const blockers: EligibilityBlocker[] = [];

  if (lifecycleStatus !== CREDIT_ELIGIBLE_STATUS) blockers.push({ code: 'ACCOUNT_NOT_ACTIVE', detail: lifecycleStatus });
  if (!facts.hasCredentials) blockers.push({ code: 'NO_CREDENTIALS' });
  if (facts.verifiedContactCount === 0) blockers.push({ code: 'CONTACT_NOT_VERIFIED' });

  const profileMissing = missingProfileFields(facts, now);
  if (profileMissing.length > 0) blockers.push({ code: 'PROFILE_INCOMPLETE', fields: profileMissing });

  const financialMissing = missingFinancialFields(facts);
  if (financialMissing.length > 0) blockers.push({ code: 'FINANCIAL_PROFILE_INCOMPLETE', fields: [...financialMissing] });

  if (!facts.hasCurrentAddress) blockers.push({ code: 'ADDRESS_MISSING' });
  if (facts.referenceContactCount < REQUIRED_REFERENCE_CONTACTS) {
    blockers.push({ code: 'REFERENCES_INSUFFICIENT', detail: `required=${REQUIRED_REFERENCE_CONTACTS}` });
  }

  if (!facts.identityDocument) blockers.push({ code: 'IDENTITY_DOCUMENT_MISSING' });
  else if (isDocumentExpired(facts.identityDocument.expiresAt, now)) blockers.push({ code: 'IDENTITY_DOCUMENT_EXPIRED' });

  if (!isIdentityVerified(facts.identityVerificationResult)) {
    blockers.push({ code: 'IDENTITY_NOT_VERIFIED', detail: facts.identityVerificationResult ?? 'not_started' });
  }
  if (facts.pendingEvidenceReviewCount > 0) blockers.push({ code: 'EVIDENCE_PENDING_REVIEW' });

  const consentMissing = missingConsentDocumentIds(facts);
  if (consentMissing.length > 0) blockers.push({ code: 'CONSENT_MISSING', fields: consentMissing });

  if (facts.openObservationCount > 0) blockers.push({ code: 'OPEN_OBSERVATIONS' });
  if (facts.unclearedWatchlistMatchCount > 0) blockers.push({ code: 'COMPLIANCE_MATCH_PENDING' });

  if (facts.latestRisk?.recommendedAction !== RISK_APPROVED_ACTION) {
    blockers.push({ code: 'RISK_NOT_APPROVED', detail: facts.latestRisk?.recommendedAction ?? 'not_evaluated' });
  } else if (isRiskStale(facts.latestRisk.decidedAt, now)) {
    blockers.push({ code: 'RISK_ASSESSMENT_STALE' });
  }

  if (facts.openFraudCaseCount > 0) blockers.push({ code: 'FRAUD_CASE_OPEN' });

  return blockers;
}

function deriveNextStep(sections: OnboardingSection[], lifecycleStatus: CustomerLifecycleStatus): EligibilityAssessment['nextStep'] {
  if (lifecycleStatus === 'blocked' || lifecycleStatus === 'rejected' || lifecycleStatus === 'closed') return 'blocked';
  if (lifecycleStatus === 'observed') return 'resolve_observations';
  const pending = sections.find((section) => section.status !== 'completed');
  if (pending) return pending.code;
  if (lifecycleStatus === 'under_review' || lifecycleStatus === 'suspended') return 'awaiting_review';
  return 'complete';
}

export function assess(facts: EligibilityFacts, lifecycleStatus: CustomerLifecycleStatus, now: Date): EligibilityAssessment {
  const sections = buildSections(facts, now);
  const blockers = buildBlockers(facts, lifecycleStatus, now);
  const completed = sections.filter((section) => section.status === 'completed').length;

  return {
    eligible: blockers.length === 0,
    lifecycleStatus,
    ruleVersion: ELIGIBILITY_RULE_VERSION,
    sections,
    completionPercentage: Math.round((completed / sections.length) * 100),
    canSubmit: completed === sections.length,
    nextStep: deriveNextStep(sections, lifecycleStatus),
    blockers,
  };
}
