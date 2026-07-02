import { ConsentDocumentModel, CustomerConsentModel } from '../../database/models/index.js';
import { ConsentDocumentResponseDto, CustomerConsentResponseDto } from './consents.dtos.js';

function toIsoOrNull(date: Date | string | null): string | null {
  if (!date) return null;
  return date instanceof Date ? date.toISOString() : date;
}

export function toConsentDocumentResponse(document: ConsentDocumentModel): ConsentDocumentResponseDto {
  return {
    id: String(document.id),
    tenantId: String(document.tenantId),
    documentCode: document.documentCode,
    versionCode: document.versionCode,
    language: document.language,
    contentUrl: document.contentUrl,
    contentHash: document.contentHash,
    requiresExplicitAction: document.requiresExplicitAction,
    effectiveFrom: toIsoOrNull(document.effectiveFrom),
    effectiveUntil: toIsoOrNull(document.effectiveUntil),
    status: document.status,
  };
}

export function toCustomerConsentResponse(consent: CustomerConsentModel): CustomerConsentResponseDto {
  return {
    id: String(consent.id),
    tenantId: String(consent.tenantId),
    customerId: String(consent.customerId),
    consentDocumentId: consent.consentDocumentId === null ? null : String(consent.consentDocumentId),
    purposeCode: consent.purposeCode,
    granted: consent.granted,
    grantedAt: toIsoOrNull(consent.grantedAt),
    revokedAt: toIsoOrNull(consent.revokedAt),
    channel: consent.channel,
  };
}
