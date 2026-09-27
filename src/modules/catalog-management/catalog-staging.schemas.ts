/**
 * @file Esquemas Zod: validan entradas y parámetros en el borde del sistema.
 * @business Esta pieza acota qué ítems de una ingesta de catálogo se pueden listar para revisarlos.
 * @system consulta de `GET /operations/catalog-staging-items`; aparte de `catalog-management.schemas.ts`, que es deuda congelada.
 */
import { z } from 'zod';

/** Ítems de staging por catálogo, ingesta y estado: lo que la decisión en lote necesita enseñar. */
export const listStagingItemsQuerySchema = z.object({
  catalogCode: z.string().trim().min(1).max(80).optional(),
  ingestionJobId: z
    .string()
    .regex(/^[1-9][0-9]*$/)
    .optional(),
  reviewStatus: z.enum(['pending_review', 'approved', 'rejected']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
});
export type ListStagingItemsQueryDto = z.infer<typeof listStagingItemsQuerySchema>;
