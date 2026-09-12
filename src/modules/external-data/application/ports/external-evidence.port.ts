/**
 * @file Puerto de evidencia de integraciones (AT-043).
 * @business Un proveedor produce evidencia mínima y una referencia verificable; el DUEÑO de las
 *   observaciones o de los features decide qué aplica y lo persiste con su propia unidad de trabajo.
 *   Integraciones guarda coste, solicitud y resultado técnico; no escribe tablas ajenas.
 * @system Valores serializables. `ExternalEvidence` no lleva el payload crudo del proveedor (queda en
 *   `data_provider_responses`, con retención propia); lleva observaciones normalizadas y una referencia.
 */
import type { NormalizedExternalObservation } from '../../domain/external-provider.types.js';

export type ExternalEvidence = Readonly<{
  tenantId: string;
  customerId: string;
  providerCode: string;
  /** `data_provider_requests._id`: referencia verificable al registro técnico. */
  requestId: string;
  /** Clave de deduplicación del hecho: el mismo proveedor+consulta+respuesta no aplica dos veces. */
  evidenceKey: string;
  observations: readonly NormalizedExternalObservation[];
  producedAt: string;
}>;

export type EvidenceApplication = Readonly<{ applied: boolean; duplicated: boolean; ownerReference: string | null }>;

/** Lo implementa el DUEÑO (Clientes para observaciones, Riesgo para features); Integraciones lo invoca. */
export interface ExternalEvidenceOwnerPort {
  apply(evidence: ExternalEvidence): Promise<EvidenceApplication>;
}

export const EXTERNAL_EVIDENCE_OWNER_PORT = 'atlas.external-data.evidence-owner-port';

/** Clave estable: proveedor + solicitud + huella del contenido normalizado. */
export function evidenceKeyFor(input: { providerCode: string; requestId: string; contentHash: string }): string {
  return `${input.providerCode}:${input.requestId}:${input.contentHash}`;
}
