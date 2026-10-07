/**
 * @file Esquema del arreglo de consentimientos del alta anónima.
 * @business La aceptación de términos es evidencia legal: el alta no puede aceptar una lista sin tope ni contradictoria.
 * @system valida forma, tamaño y unicidad por documento antes de que el servicio consulte cada uno.
 */
import { z } from 'zod';

export const startConsentsSchema = z
  .array(
    z.object({
      consentDocumentId: z.string().regex(/^[1-9][0-9]*$/),
      purposeCode: z.string().trim().min(1).max(80),
      granted: z.boolean(),
      acceptedAt: z.string().datetime().optional(),
    }),
  )
  .min(1, 'Se requiere al menos un consentimiento.')
  // Una consulta por elemento en el alta anónima: sin tope, una sola petición lanzaba miles. Y un documento
  // repetido (granted y declined a la vez) deja una evidencia contradictoria.
  .max(20, 'Demasiados consentimientos.')
  .refine((items) => new Set(items.map((item) => item.consentDocumentId)).size === items.length, 'Consentimiento repetido.');
