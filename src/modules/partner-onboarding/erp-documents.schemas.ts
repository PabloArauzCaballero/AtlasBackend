/**
 * @file Esquemas Zod: validan entradas HTTP antes de tocar el dominio.
 * @business Esta pieza acota qué documentos puede guardar el ERP y con qué tamaño.
 * @system define los cuerpos del permiso de subida, la verificación y la lectura de documentos del ERP.
 */
import { z } from 'zod';
import { ALLOWED_EVIDENCE_MIME_TYPES, MAX_EVIDENCE_BYTES } from '../../common/storage/document-storage.service.js';

const slug = z
  .string()
  .trim()
  .min(1)
  .max(80)
  .regex(/^[A-Za-z0-9_-]+$/u);

export const erpDocumentUploadUrlSchema = z
  .object({
    /** Quién es el dueño en el ERP: `B2B_ACCOUNT`, `BUSINESS_PARTNER`, `ONBOARDING_CASE`… */
    ownerType: slug,
    ownerId: slug,
    /** Qué documento es: `kyb`, `nit`, `matricula`, `poder`… */
    documentKind: slug.default('documento'),
    contentType: z.enum(ALLOWED_EVIDENCE_MIME_TYPES),
    sizeBytes: z.number().int().positive().max(MAX_EVIDENCE_BYTES),
  })
  .strict();
export type ErpDocumentUploadUrlDto = z.infer<typeof erpDocumentUploadUrlSchema>;

export const erpDocumentVerifySchema = z
  .object({
    storageKey: z.string().trim().min(1).max(500),
    sha256: z
      .string()
      .trim()
      .regex(/^[a-fA-F0-9]{64}$/u),
    contentType: z.enum(ALLOWED_EVIDENCE_MIME_TYPES),
    sizeBytes: z.number().int().positive().max(MAX_EVIDENCE_BYTES).optional(),
  })
  .strict();
export type ErpDocumentVerifyDto = z.infer<typeof erpDocumentVerifySchema>;

export const erpDocumentContentQuerySchema = z.object({ storageKey: z.string().trim().min(1).max(500) });
export type ErpDocumentContentQueryDto = z.infer<typeof erpDocumentContentQuerySchema>;
