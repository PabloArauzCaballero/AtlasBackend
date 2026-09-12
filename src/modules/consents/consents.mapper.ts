/**
 * @file Mapper: transforma modelos internos a contratos de transporte.
 * @business Esta pieza demuestra qué tratamiento de datos aceptó o rechazó cada cliente y bajo qué versión legal.
 * @system registra decisiones y eventos de consentimiento con separación entre DTO, reglas y persistencia.
 */
import { ConsentDocumentModel, CustomerConsentModel } from '../../database/models/index.js';
import { ConsentDocumentResponseDto, CustomerConsentResponseDto } from './consents.dtos.js';
import { toIsoOrNull } from '../../common/utils/dates/date.util.js';

export function toConsentDocumentResponse(document: ConsentDocumentModel): ConsentDocumentResponseDto {
  return {
    id: String(document.id),
    tenantId: String(document.tenantId),
    documentCode: document.documentCode,
    versionCode: document.versionCode,
    language: document.language,
    contentUrl: document.contentUrl,
    // El texto viaja con el documento: sin el, la casilla del registro pide una firma en blanco.
    title: document.title,
    summary: document.summary,
    bodyMarkdown: document.bodyMd,
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
