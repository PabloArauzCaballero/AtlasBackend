/**
 * @file Esquemas Zod: validan entradas y parámetros en el borde del sistema.
 * @business Lo copiado de la competencia que sí sirve: QR de cobro sin monto, factura de servicio, audio de ocupación.
 * @system valida el registro de una evidencia de apoyo ya subida por URL firmada.
 */
import { z } from 'zod';
import { ALLOWED_EVIDENCE_MIME_TYPES } from '../../common/storage/document-storage.service.js';
/**
 * Una evidencia de apoyo de la fase 3, fuera de cualquier paquete: QR de cobro sin monto (prueba de
 * acceso bancario), factura o preaviso de servicio (prueba de domicilio) o audio corto de ocupación.
 * Ninguna decide sola; las tres van a revisión humana.
 */
export const SUPPORTING_EVIDENCE_TYPES = ['bank_qr_proof', 'proof_of_address', 'occupation_audio'] as const;

export const supportingEvidenceSchema = z
  .object({
    evidenceType: z.enum(SUPPORTING_EVIDENCE_TYPES),
    storageKey: z.string().trim().min(3).max(500),
    mimeType: z.enum(ALLOWED_EVIDENCE_MIME_TYPES),
    sha256Hash: z.string().regex(/^[a-f0-9]{64}$/i),
    fileSizeBytes: z
      .string()
      .regex(/^[0-9]+$/)
      .optional(),
    /** Qué es (p. ej. «factura de luz de agosto»). Corto y opcional; nunca datos sensibles. */
    note: z.string().trim().max(120).optional(),
  })
  .strict();

export type SupportingEvidenceDto = z.infer<typeof supportingEvidenceSchema>;
