/**
 * @file DTOs: contrato estable de salida sin filtrar modelos de persistencia.
 * @business Esta pieza demuestra qué tratamiento de datos aceptó o rechazó cada cliente y bajo qué versión legal.
 * @system registra decisiones y eventos de consentimiento con separación entre DTO, reglas y persistencia.
 */
export type ConsentDocumentResponseDto = {
  id: string;
  tenantId: string;
  documentCode: string | null;
  versionCode: string | null;
  language: string | null;
  contentUrl: string | null;
  contentHash: string | null;
  /** Titulo y cuerpo del documento. Sin ellos la casilla del registro pide una firma en blanco. */
  title: string | null;
  summary: string | null;
  bodyMarkdown: string | null;
  requiresExplicitAction: boolean | null;
  effectiveFrom: string | null;
  effectiveUntil: string | null;
  status: string | null;
};

export type CustomerConsentResponseDto = {
  id: string;
  tenantId: string;
  customerId: string;
  consentDocumentId: string | null;
  purposeCode: string | null;
  granted: boolean | null;
  grantedAt: string | null;
  revokedAt: string | null;
  channel: string | null;
};
