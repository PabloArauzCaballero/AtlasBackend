/**
 * @file Contrato de lectura de la regla de habilitación crediticia.
 * @business Esta pieza fija qué hechos del cliente se consideran al decidir si puede avanzar.
 * @system tipo compartido entre el repositorio que lo lee y el evaluador que lo interpreta.
 */
import type {
  CustomerIdentityDocumentModel,
  CustomerProfileVersionModel,
  RiskAssessmentResultModel,
} from '../../../database/models/index.js';

/** Fotografía de todo lo que la regla de habilitación necesita, leída en una sola pasada. */
export type EligibilityFacts = {
  hasCredentials: boolean;
  verifiedContactCount: number;
  profile: CustomerProfileVersionModel | null;
  presentFinancialAttributeCodes: string[];
  /** Valores numéricos vigentes por código. Lo consume la elegibilidad POR PRODUCTO. */
  financialAttributeValues: Readonly<Record<string, number>>;
  hasCurrentAddress: boolean;
  referenceContactCount: number;
  identityDocument: CustomerIdentityDocumentModel | null;
  identityVerificationResult: string | null;
  pendingEvidenceReviewCount: number;
  grantedConsentDocumentIds: string[];
  requiredConsentDocumentIds: string[];
  openObservationCount: number;
  unclearedWatchlistMatchCount: number;
  latestRisk: RiskAssessmentResultModel | null;
  openFraudCaseCount: number;
};
