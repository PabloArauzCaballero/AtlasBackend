/**
 * @file Esquemas Zod: validan la cola interna de solicitudes del titular en el borde.
 * @business Esta pieza hace exigibles los derechos de privacidad y limita el uso de datos personales.
 * @system filtros de la lista, id de la solicitud y cuerpo de la transición de estado.
 */
import { z } from 'zod';
import { DATA_SUBJECT_REQUEST_STATUSES, DATA_SUBJECT_REQUEST_TYPES } from './data-subject-request.state.js';

const positiveId = z.string().regex(/^[1-9][0-9]*$/u);

/**
 * La cola vista por cumplimiento: todo el tenant, filtrable y paginada.
 *
 * `overdue` es texto y no booleano coercionado porque `z.coerce.boolean()` convierte «false» en
 * `true` (cualquier cadena no vacía lo es): pedir las NO vencidas devolvería las vencidas.
 */
export const operationsPrivacyRequestsQuerySchema = z.object({
  status: z.enum(DATA_SUBJECT_REQUEST_STATUSES).optional(),
  type: z.enum(DATA_SUBJECT_REQUEST_TYPES).optional(),
  overdue: z.enum(['true', 'false']).optional(),
  customerId: positiveId.optional(),
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(100).default(25),
});
export type OperationsPrivacyRequestsQueryDto = z.infer<typeof operationsPrivacyRequestsQuerySchema>;

export const privacyRequestParamsSchema = z.object({ requestId: positiveId });
export type PrivacyRequestParamsDto = z.infer<typeof privacyRequestParamsSchema>;

/**
 * Mover la solicitud de estado. `reason` es opcional en el esquema y obligatorio para cerrarla
 * (`completed` o `rejected`): esa regla vive en la máquina de estados, que es quien sabe qué
 * transición lo exige, y responde 422 con un código que el portal puede enseñar.
 */
export const privacyRequestTransitionSchema = z.object({
  toStatus: z.enum(['in_progress', 'completed', 'rejected']),
  reason: z.string().trim().min(10).max(2000).optional(),
});
export type PrivacyRequestTransitionDto = z.infer<typeof privacyRequestTransitionSchema>;
