/**
 * @file Esquemas Zod de las dos listas de la mesa: la cola de espera y «mis conversaciones».
 * @business Deja al agente buscar y recorrer sus conversaciones sin que el servidor corte en silencio a las primeras 50.
 * @system valida `GET internal/support/desk/queue` y `GET internal/support/desk/mine`; sin `limit` responden como antes (50).
 */
import { z } from 'zod';
import { SUPPORT_ASSIGNED_CHANNEL_STATUSES, SUPPORT_CHANNEL_TYPES } from './support.constants.js';

/** Las 50 de siempre: quien no pide página sigue viendo lo mismo que antes. */
export const SUPPORT_DESK_LEGACY_LIMIT = 50;

const pageQuery = {
  page: z.coerce.number().int().positive().default(1),
  /** Sin `limit` se conserva el corte histórico de 50; con `limit`, de 1 a 100. */
  limit: z.coerce.number().int().positive().max(100).default(SUPPORT_DESK_LEGACY_LIMIT),
  /** Por partes: código y n.º de la conversación, n.º del expediente y tipo de canal. */
  q: z.string().trim().min(1).max(120).optional(),
  channelType: z.enum(SUPPORT_CHANNEL_TYPES).optional(),
};

/** La cola de espera: conversaciones sin agente, acotables a una cola de atención. */
export const listDeskQueueQuerySchema = z.object({
  queueId: z
    .string()
    .regex(/^[1-9][0-9]{0,18}$/u)
    .optional(),
  ...pageQuery,
});
export type ListDeskQueueQueryDto = z.infer<typeof listDeskQueueQuerySchema>;

/** «Mis conversaciones»: las vivas que lleva el agente, filtrables por su estado. */
export const listDeskMineQuerySchema = z.object({
  status: z.enum(SUPPORT_ASSIGNED_CHANNEL_STATUSES).optional(),
  ...pageQuery,
});
export type ListDeskMineQueryDto = z.infer<typeof listDeskMineQuerySchema>;
