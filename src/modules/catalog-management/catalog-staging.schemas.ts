/**
 * @file Esquemas Zod: validan entradas y parámetros en el borde del sistema.
 * @business Esta pieza acota qué ítems de una ingesta de catálogo se pueden listar para revisarlos.
 * @system consulta de `GET /operations/catalog-staging-items`; aparte de `catalog-management.schemas.ts`, que es deuda congelada.
 */
import { z } from 'zod';
import { queryBooleanSchema } from '../../common/pipes/query-boolean.schema.js';

/** Ítems de staging por catálogo, ingesta y estado: lo que la decisión en lote necesita enseñar. */
export const listStagingItemsQuerySchema = z.object({
  catalogCode: z.string().trim().min(1).max(80).optional(),
  ingestionJobId: z
    .string()
    .regex(/^[1-9][0-9]*$/)
    .optional(),
  reviewStatus: z.enum(['pending_review', 'approved', 'rejected']).optional(),
  /** Por partes: código y nombre propuestos y n.º del ítem en staging. */
  q: z.string().trim().min(1).max(120).optional(),
  /** Sólo los que propuso la IA (`true`) o sólo los que no (`false`). */
  aiSuggested: queryBooleanSchema.optional(),
  page: z.coerce.number().int().min(1).default(1),
  /** El nombre de siempre; `limit` es el canónico y, si llegan los dos, manda `limit`. */
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
  limit: z.coerce.number().int().min(1).max(200).optional(),
});
export type ListStagingItemsQueryDto = z.infer<typeof listStagingItemsQuerySchema>;
