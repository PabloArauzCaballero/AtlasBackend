/**
 * @file Esquemas Zod: validan entradas y parámetros en el borde del sistema.
 * @business Esta pieza permite resolver excepciones y revisiones manuales con responsabilidad y trazabilidad.
 * @system gestiona colas y decisiones operativas mediante servicios transaccionales y repositorios aislados.
 */
import { z } from 'zod';

export const workQueueQuerySchema = z.object({
  queue: z.enum(['manual_review', 'fraud', 'all']).default('all'),
  status: z.string().trim().min(1).max(40).optional(),
  priority: z.string().trim().min(1).max(40).optional(),
  customerId: z
    .string()
    .regex(/^[1-9][0-9]*$/)
    .optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
  sortBy: z.enum(['createdAt', 'updatedAt']).default('createdAt'),
  sortOrder: z.enum(['asc', 'desc']).default('desc'),
});

export const operationsCustomerIdParamsSchema = z.object({
  customerId: z.string().regex(/^[1-9][0-9]*$/),
});

export type WorkQueueQueryDto = z.infer<typeof workQueueQuerySchema>;
export type OperationsCustomerIdParamsDto = z.infer<typeof operationsCustomerIdParamsSchema>;

/**
 * ATLAS-P11-T10: query schema para las variantes por cursor de las colas individuales
 * (`manual-review-cases`, `fraud-cases`). Deliberadamente NO cubre `queue: 'all'` — la vista
 * combinada sigue siendo OFFSET hasta que se resuelva la fusión de dos fuentes de cursor
 * heterogéneas (ver nota en `operations.repository.ts`).
 */
export const cursorWorkQueueQuerySchema = z.object({
  status: z.string().trim().min(1).max(40).optional(),
  priority: z.string().trim().min(1).max(40).optional(),
  customerId: z
    .string()
    .regex(/^[1-9][0-9]*$/)
    .optional(),
  limit: z.coerce.number().int().positive().max(100).default(20),
  sortBy: z.enum(['createdAt', 'updatedAt']).default('createdAt'),
  cursor: z.string().trim().min(1).max(500).optional(),
});

export type CursorWorkQueueQueryDto = z.infer<typeof cursorWorkQueueQuerySchema>;

export const manualReviewDecisionParamsSchema = z.object({
  caseId: z.string().regex(/^[1-9][0-9]*$/),
});

// El schema de decisión de fraude vive en el dominio `fraud`.

/**
 * `nextCustomerStatus` pasa a expresarse en los estados canónicos de la máquina de estados del
 * cliente (`CUSTOMER_LIFECYCLE_STATUSES`).
 *
 * Antes aceptaba `approved_for_next_step`, `pending_more_information`, `pending_fraud_review` y
 * `registered`: valores que NADIE escribía en `customers.lifecycle_status` y que además colisionaban
 * con el vocabulario del motor de riesgo (`recommended_action`). El resultado era un campo que
 * parecía cambiar el estado del cliente y no cambiaba nada.
 */
export const manualReviewDecisionSchema = z.object({
  decision: z.enum(['approved', 'rejected', 'request_more_information', 'escalated_to_fraud', 'no_action']),
  reasonCode: z.string().trim().min(1).max(120),
  notes: z.string().trim().max(2000).optional(),
  nextCustomerStatus: z.enum(['active', 'observed', 'under_review', 'rejected', 'blocked', 'suspended']).optional(),
});

// El schema de decisión de fraude vive en el dominio `fraud`.

export type ManualReviewDecisionParamsDto = z.infer<typeof manualReviewDecisionParamsSchema>;
export type ManualReviewDecisionDto = z.infer<typeof manualReviewDecisionSchema>;
