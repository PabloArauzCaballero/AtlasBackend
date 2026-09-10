/**
 * @file Contratos HTTP: validan la entrada de la cola de revisión de flujos.
 * @business Esta pieza acota qué se puede pedir a la cola de revisión humana de flujos.
 * @system valida filtros y paginación con Zod antes de llegar al servicio.
 */
import { z } from 'zod';

export const flowReviewQueueSchema = z.object({
  reviewStatus: z.enum(['AUTO_DETECTED', 'NEEDS_REVIEW', 'APPROVED', 'REJECTED']).default('NEEDS_REVIEW'),
  systemCode: z.string().trim().min(1).max(60).optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
});
export type FlowReviewQueueDto = z.infer<typeof flowReviewQueueSchema>;
