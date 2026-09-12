/**
 * @file Contratos HTTP: validan la entrada de la cola de revisión de flujos.
 * @business Esta pieza acota qué se puede pedir a la cola de revisión humana de flujos y cómo se decide.
 * @system valida filtros, paginación y decisiones con Zod antes de llegar al servicio.
 */
import { z } from 'zod';
import { reviewDecisionSchema } from './systems-ops.schemas.js';

export const flowReviewQueueSchema = z.object({
  reviewStatus: z.enum(['AUTO_DETECTED', 'NEEDS_REVIEW', 'APPROVED', 'REJECTED']).default('NEEDS_REVIEW'),
  systemCode: z.string().trim().min(1).max(60).optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
});
export type FlowReviewQueueDto = z.infer<typeof flowReviewQueueSchema>;

export const flowReviewDecisionSchema = reviewDecisionSchema.extend({
  /**
   * La huella del código que la persona tenía delante, tal como vino en la cola. Si el código cambió
   * desde entonces, la decisión se rechaza: sin esto se podía aprobar un código que nadie había visto.
   */
  depsHash: z.string().max(32).nullable(),
});
export type FlowReviewDecisionDto = z.infer<typeof flowReviewDecisionSchema>;
