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

/**
 * La cuenta del ERP cuyo comercio tiene que tener carpeta. Lleva lo necesario para abrir la ficha
 * si todavía no existe (razón social, NIT y un correo de contacto de la cuenta).
 */
export const erpMerchantExpedienteSchema = z
  .object({
    erpAccountId: z.string().uuid(),
    legalName: z.string().trim().min(1).max(220),
    tradeName: z.string().trim().max(220).nullish(),
    taxId: z.string().trim().max(60).nullish(),
    contactEmail: z.string().trim().max(180).nullish(),
    contactPhone: z.string().trim().max(40).nullish(),
  })
  .strict();
export type ErpMerchantExpedienteDto = z.infer<typeof erpMerchantExpedienteSchema>;
