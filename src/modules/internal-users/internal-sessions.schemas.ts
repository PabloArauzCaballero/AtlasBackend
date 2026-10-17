/**
 * @file Esquemas Zod: validan entradas y parámetros en el borde del sistema.
 * @business Esta pieza controla quién puede operar Atlas y deja evidencia de cada asignación de privilegios.
 * @system valida la lectura de sesiones abiertas del personal y el cierre de las de una persona.
 */
import { z } from 'zod';

export const listInternalSessionsQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(50),
});

export type ListInternalSessionsQueryDto = z.infer<typeof listInternalSessionsQuerySchema>;

export const revokeInternalSessionsSchema = z.object({
  reason: z.string().trim().min(8).max(500),
});

export type RevokeInternalSessionsDto = z.infer<typeof revokeInternalSessionsSchema>;
