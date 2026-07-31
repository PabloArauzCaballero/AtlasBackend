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
