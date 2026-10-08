/**
 * @file Esquemas Zod: validan entradas y parámetros en el borde del sistema.
 * @business Esta pieza mantiene la identidad operativa, ciclo de vida y elegibilidad del cliente como fuente de verdad.
 * @system expone casos de uso de cliente, evaluación de condiciones y transiciones de estado persistidas.
 */
import { z } from 'zod';

export const customerIdParamsSchema = z.object({
  customerId: z.string().regex(/^[1-9][0-9]*$/),
});

export type CustomerIdParamsDto = z.infer<typeof customerIdParamsSchema>;

/** El permiso de subida de la foto de perfil: sólo JPEG o PNG y de 5 MB como mucho (la app la comprime antes). */
export const profilePhotoUploadUrlSchema = z.object({
  contentType: z.enum(['image/jpeg', 'image/png']),
  sizeBytes: z
    .number()
    .int()
    .positive()
    .max(5 * 1024 * 1024),
});

export type ProfilePhotoUploadUrlDto = z.infer<typeof profilePhotoUploadUrlSchema>;

/** Fijar como foto el objeto recién subido. La clave la impuso el servidor al emitir el permiso. */
export const profilePhotoConfirmSchema = z.object({
  storageKey: z.string().min(1).max(300),
});

export type ProfilePhotoConfirmDto = z.infer<typeof profilePhotoConfirmSchema>;
