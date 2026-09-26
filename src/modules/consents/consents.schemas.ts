/**
 * @file Esquemas Zod: validan entradas y parámetros en el borde del sistema.
 * @business Esta pieza demuestra qué tratamiento de datos aceptó o rechazó cada cliente y bajo qué versión legal.
 * @system registra decisiones y eventos de consentimiento con separación entre DTO, reglas y persistencia.
 */
import { z } from 'zod';

/**
 * `purposeCode` filtra por `consent_documents.document_code`, no por una finalidad de tratamiento
 * (`privacy_processing_purposes`). El nombre se conserva porque es contrato publicado con el
 * frontend; renombrarlo exigiría versionar la ruta.
 *
 * No se aceptan `channel` ni `countryCode`: `consent_documents` no tiene esas columnas, y un
 * parámetro que el backend ignora en silencio le haría creer al cliente que filtró cuando no lo
 * hizo. Si el negocio los necesita, entran con su migración y su filtro real, no antes.
 */
export const listActiveConsentDocumentsQuerySchema = z.object({
  language: z.string().trim().min(2).max(10).default('es'),
  purposeCode: z.string().trim().min(1).max(80).optional(),
});

export type ListActiveConsentDocumentsQueryDto = z.infer<typeof listActiveConsentDocumentsQuerySchema>;

/**
 * Publicacion de una version de documento de consentimiento.
 *
 * El cuerpo es OBLIGATORIO: publicar un consentimiento sin texto es exactamente el estado del que
 * venimos —una casilla que pide una firma sobre algo que no se puede leer—.
 */
export const createConsentDocumentSchema = z
  .object({
    documentCode: z
      .string()
      .trim()
      .min(3)
      .max(80)
      .regex(/^[a-z0-9_]+$/, 'El codigo admite minusculas, digitos y guion bajo.'),
    versionCode: z.string().trim().min(1).max(40),
    language: z.string().trim().min(2).max(10).default('es'),
    title: z.string().trim().min(3).max(200),
    summary: z.string().trim().max(500).optional(),
    bodyMarkdown: z.string().trim().min(20),
    contentUrl: z.string().trim().url().max(500).optional(),
    /** Si exige una casilla marcada, o basta con informar. */
    requiresExplicitAction: z.boolean().default(true),
    effectiveFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Usa AAAA-MM-DD.'),
  })
  .strict();
export type CreateConsentDocumentDto = z.infer<typeof createConsentDocumentSchema>;

/**
 * Correccion de un documento existente.
 *
 * NO admite `documentCode` ni `versionCode`: son la identidad de lo que alguien acepto, y cambiarlas
 * convertiria la evidencia en algo que no prueba nada.
 */
export const updateConsentDocumentSchema = z
  .object({
    title: z.string().trim().min(3).max(200).optional(),
    summary: z.string().trim().max(500).optional(),
    bodyMarkdown: z.string().trim().min(20).optional(),
    contentUrl: z.string().trim().url().max(500).optional(),
    requiresExplicitAction: z.boolean().optional(),
    status: z.enum(['draft', 'published', 'retired']).optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, { message: 'No hay nada que cambiar.' });
export type UpdateConsentDocumentDto = z.infer<typeof updateConsentDocumentSchema>;
