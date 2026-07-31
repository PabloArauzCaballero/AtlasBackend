/**
 * @file Artefacto de soporte específico de esta carpeta.
 * @business Esta pieza mantiene la identidad operativa, ciclo de vida y elegibilidad del cliente como fuente de verdad.
 * @system expone casos de uso de cliente, evaluación de condiciones y transiciones de estado persistidas.
 */
import {
  ELIGIBILITY_RULE_VERSION,
  EligibilityBlockerCode,
  IDENTITY_VERIFIED_RESULT,
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
import { CREDIT_ELIGIBLE_STATUS, CustomerLifecycleStatus } from '../customer-lifecycle.constants.js';
import { EligibilityFacts } from '../repositories/customer-eligibility.repository.js';

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

function missingFinancialFields(facts: EligibilityFacts): string[] {
  const present = new Set(facts.presentFinancialAttributeCodes);
  return REQUIRED_FINANCIAL_ATTRIBUTE_CODES.filter((code) => !present.has(code));
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

  return [
    {
      code: 'contact_verification',
      status: facts.verifiedContactCount > 0 ? 'completed' : 'pending',
      missingFields: facts.verifiedContactCount > 0 ? [] : ['verifiedContact'],
    },
    {
      code: 'personal_data',
      status: sectionStatus(profileMissing, facts.profile !== null),
      missingFields: profileMissing,
    },
    {
      code: 'financial_profile',
      status: sectionStatus(financialMissing, facts.presentFinancialAttributeCodes.length > 0),
      missingFields: financialMissing,
    },
    {
      code: 'address',
      status: facts.hasCurrentAddress ? 'completed' : 'pending',
      missingFields: facts.hasCurrentAddress ? [] : ['address'],
    },
    {
      code: 'identity_documents',
      status: sectionStatus(identityMissing, facts.identityDocument !== null),
      missingFields: identityMissing,
    },
    {
      code: 'reference_contacts',
      status: sectionStatus(referenceMissing, facts.referenceContactCount > 0),
      missingFields: referenceMissing,
    },
  ];
}

/** Bloqueadores de la habilitación. Lista completa: nunca corta en el primero encontrado. */
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

  if (facts.identityVerificationResult !== IDENTITY_VERIFIED_RESULT) {
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
