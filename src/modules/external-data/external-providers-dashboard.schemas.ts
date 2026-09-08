/**
 * @file Contratos Zod de entrada del tablero de proveedores externos.
 * @business Esta pieza incorpora evidencia KYC, financiera y de confianza con control de costo, consentimiento y disponibilidad.
 * @system aísla proveedores detrás de adaptadores resilientes y políticas de gobierno, ejecución y evidencia.
 */
import { z } from 'zod';

/**
 * Van en archivo propio y no en `external-data.schemas.ts` por el trinquete `check:file-size`:
 * aquel archivo está a 282 líneas y el límite para un archivo runtime es 300.
 */

/** `coerce` porque llegan como query string: `?days=7` es la cadena "7", no el número. */
const daysSchema = z.coerce.number().int().min(1).max(90);

export const dashboardQuerySchema = z.object({
  days: daysSchema.default(1),
  // Tope bajo a propósito: son los puntos de la serie de salud de CADA proveedor, y se piden nueve
  // veces en la misma petición.
  healthPoints: z.coerce.number().int().min(2).max(120).default(30),
});
export type DashboardQueryDto = z.infer<typeof dashboardQuerySchema>;

export const providerRequestsQuerySchema = z.object({
  days: daysSchema.default(7),
  providerCode: z.string().trim().min(2).max(80).optional(),
  customerId: z.string().trim().min(1).max(40).optional(),
  /**
   * Lista separada por comas (`?responseStatus=FAILED,RATE_LIMITED`). Se acepta como texto libre
   * y no como enum cerrado a propósito: `response_status` es una columna de texto que ha ganado
   * valores nuevos con cada versión, y un enum aquí convertiría un filtro desconocido en un error
   * 400 en lugar de en una lista vacía.
   */
  responseStatus: z
    .string()
    .trim()
    .max(400)
    .optional()
    .transform((value) =>
      value
        ? value
            .split(',')
            .map((item) => item.trim().toUpperCase())
            .filter((item) => item !== '')
        : undefined,
    ),
  approvalStatus: z.string().trim().min(2).max(40).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).max(100_000).default(0),
});
export type ProviderRequestsQueryDto = z.infer<typeof providerRequestsQuerySchema>;
