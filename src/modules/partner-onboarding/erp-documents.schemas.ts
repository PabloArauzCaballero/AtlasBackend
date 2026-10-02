/**
 * @file Esquemas Zod: validan entradas HTTP antes de tocar el dominio.
 * @business Esta pieza acota qué documentos puede guardar el ERP y con qué tamaño.
 * @system define los cuerpos del permiso de subida, la verificación y la lectura de documentos del ERP.
 */
import { z } from 'zod';
import { ALLOWED_EVIDENCE_MIME_TYPES, MAX_EVIDENCE_BYTES } from '../../common/storage/document-storage.service.js';
import { legalRepresentativeSchema, registerBranchSchema, registerQrSchema } from './partner-onboarding.schemas.js';

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
 *
 * Desde el 2026-10-02 lleva ADEMÁS lo que el expediente exige para enviarse a revisión —matrícula,
 * representante legal con su poder, una sucursal y el QR bancario—, todo opcional: el vendedor lo
 * captura una sola vez en el alta del ERP y el expediente nace sin huecos. Hasta entonces el ERP
 * mandaba seis campos y el comercio tenía que volver a llenar en su portal lo que ya había
 * entregado (Pablo, 2026-10-02: «el usuario te lo pasa una vez y esto debe estar listo»).
 *
 * Los bloques reutilizan los esquemas del expediente, así que lo que acepta el ERP es exactamente lo
 * que acepta el portal del comercio. Los archivos (poder y QR) llegan como `storageKey` emitida por
 * `merchant-expediente/:partnerId/upload-url`: el ERP sube el objeto a la carpeta del comercio.
 */
export const erpMerchantExpedienteSchema = z
  .object({
    erpAccountId: z.string().uuid(),
    legalName: z.string().trim().min(1).max(220),
    tradeName: z.string().trim().max(220).nullish(),
    taxId: z.string().trim().max(60).nullish(),
    contactEmail: z.string().trim().max(180).nullish(),
    contactPhone: z.string().trim().max(40).nullish(),
    commercialRegistry: z.string().trim().min(3).max(60).nullish(),
    businessCategory: z.string().trim().min(2).max(80).nullish(),
    legalRepresentative: legalRepresentativeSchema.nullish(),
    branch: registerBranchSchema.nullish(),
    bankQr: registerQrSchema.nullish(),
    /** Con todo completo, enviar a revisión en el mismo paso (dispara la verificación del Motor). */
    submitWhenComplete: z.boolean().optional(),
  })
  .strict();
export type ErpMerchantExpedienteDto = z.infer<typeof erpMerchantExpedienteSchema>;

/** Permiso de subida DENTRO de la carpeta del comercio, para el poder notarial y el QR bancario que capturó el ERP. */
export const erpMerchantExpedienteUploadUrlSchema = z
  .object({
    documentKind: z.enum(['power-of-attorney', 'bank-qr']),
    contentType: z.enum(['application/pdf', 'image/jpeg', 'image/png']),
    sizeBytes: z
      .number()
      .int()
      .positive()
      .max(10 * 1024 * 1024),
  })
  .strict()
  .refine((value) => value.documentKind !== 'bank-qr' || value.contentType !== 'application/pdf', {
    message: 'Un QR es una imagen: PNG o JPG.',
    path: ['contentType'],
  });
export type ErpMerchantExpedienteUploadUrlDto = z.infer<typeof erpMerchantExpedienteUploadUrlSchema>;
