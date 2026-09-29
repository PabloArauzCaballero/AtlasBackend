/**
 * @file Esquemas Zod: validan entradas y parámetros en el borde del sistema.
 * @business Esta pieza permite resolver excepciones y revisiones manuales con responsabilidad y trazabilidad.
 * @system gestiona colas y decisiones operativas mediante servicios transaccionales y repositorios aislados.
 */
import { z } from 'zod';

/**
 * El buscador de la cola: código del cliente o del caso, por coincidencia parcial (ILIKE) y, si son
 * sólo dígitos, también el número del caso o del cliente exacto. Antes la pantalla sólo aceptaba el
 * número interno del cliente, que la persona de operaciones no ve en ninguna otra parte.
 */
const queueSearchSchema = z.string().trim().min(1).max(80);

export const workQueueQuerySchema = z.object({
  queue: z.enum(['manual_review', 'fraud', 'all']).default('all'),
  status: z.string().trim().min(1).max(40).optional(),
  priority: z.string().trim().min(1).max(40).optional(),
  customerId: z
    .string()
    .regex(/^[1-9][0-9]*$/)
    .optional(),
  q: queueSearchSchema.optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
  sortBy: z.enum(['createdAt', 'updatedAt']).default('createdAt'),
  sortOrder: z.enum(['asc', 'desc']).default('desc'),
});

/**
 * La cola «contactos sin verificar», por páginas. Antes no tenía parámetros: devolvía los 200 más
 * recientes y la pantalla contaba sobre esa lista, así que el 201 no existía para nadie.
 */
export const pendingContactsQuerySchema = z.object({
  /** Código del cliente, dominio del correo o últimos 4 del teléfono/correo, por coincidencia parcial. */
  q: z.string().trim().min(1).max(80).optional(),
  contactType: z.enum(['email', 'phone']).optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(25),
});
export type PendingContactsQueryDto = z.infer<typeof pendingContactsQuerySchema>;

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
  q: queueSearchSchema.optional(),
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
