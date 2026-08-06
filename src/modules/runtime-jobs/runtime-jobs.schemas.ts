/**
 * @file Esquemas Zod: validan entradas y parámetros en el borde del sistema.
 * @business Esta pieza completa trabajo asíncrono y recuperable fuera de la latencia del request.
 * @system reclama, procesa y reintenta jobs/outbox con locks y métricas operativas.
 */
import { z } from 'zod';

export const expireStaleSessionsSchema = z.object({
  maxIdleMinutes: z.number().int().positive().max(43_200).default(120),
  dryRun: z.boolean().default(true),
});

export const processOutboxSchema = z.object({
  limit: z.number().int().positive().max(500).default(50),
  dryRun: z.boolean().default(true),
});

export const processEventsSchema = z.object({
  limit: z.number().int().positive().max(500).default(50),
  dryRun: z.boolean().default(true),
});

export const applyRetentionPoliciesSchema = z.object({
  policyCode: z.string().min(1).max(120).optional(),
  dryRun: z.boolean().default(true),
});

export const recalculateDataQualitySchema = z.object({
  customerId: z
    .string()
    .regex(/^[1-9][0-9]*$/)
    .optional(),
  dryRun: z.boolean().default(true),
});

/**
 * Barrido de mensajes de notificación que quedaron a medio entregar (hallazgo A-03). El corte por
 * antigüedad evita competir con una entrega legítima en vuelo: 15 minutos es holgado frente a lo que
 * tarda un broadcast grande y corto frente a lo que un cliente toleraría sin recibir su aviso.
 */
export const retryStuckNotificationsSchema = z.object({
  olderThanMinutes: z.number().int().positive().max(1_440).default(15),
  limit: z.number().int().positive().max(500).default(100),
  dryRun: z.boolean().default(true),
});

/**
 * Entrega de los mensajes recién creados por un broadcast, cuando la API no entrega dentro del
 * request (`NOTIFICATIONS_DELIVERY_MODE=deferred`). No lleva corte por antigüedad —a diferencia de
 * `retryStuckNotifications`— porque su pregunta es la contraria: aquí interesa lo MÁS reciente.
 */
export const deliverPendingNotificationsSchema = z.object({
  limit: z.number().int().positive().max(500).default(100),
  dryRun: z.boolean().default(true),
});

/**
 * Purga de claves de idempotencia ya resueltas. `retentionDays` no baja de 1 a propósito: la ventana
 * de reintento de un cliente es de minutos u horas, pero borrar una clave que todavía podría
 * replayearse convertiría un reintento en una segunda ejecución del comando.
 */
export const purgeIdempotencyKeysSchema = z.object({
  retentionDays: z.number().int().min(1).max(365).default(30),
  limit: z.number().int().positive().max(10_000).default(1_000),
  dryRun: z.boolean().default(true),
});

/**
 * Recuperación de eventos varados en `processing` porque el proceso que los reclamó murió antes de
 * resolverlos. `olderThanMinutes` no baja de 1 a propósito: el corte debe superar la duración normal
 * de una entrega, o el reaper devolvería a la cola eventos que SÍ se están procesando ahora mismo y
 * crearía la duplicidad que el bloqueo existe para evitar.
 */
export const reclaimStuckEventsSchema = z.object({
  olderThanMinutes: z.number().int().min(1).max(1_440).default(15),
  limit: z.number().int().positive().max(500).default(100),
  dryRun: z.boolean().default(true),
});

export type ReclaimStuckEventsDto = z.infer<typeof reclaimStuckEventsSchema>;
export type ExpireStaleSessionsDto = z.infer<typeof expireStaleSessionsSchema>;
export type RetryStuckNotificationsDto = z.infer<typeof retryStuckNotificationsSchema>;
export type DeliverPendingNotificationsDto = z.infer<typeof deliverPendingNotificationsSchema>;
export type PurgeIdempotencyKeysDto = z.infer<typeof purgeIdempotencyKeysSchema>;
export type ProcessOutboxDto = z.infer<typeof processOutboxSchema>;
export type ProcessEventsDto = z.infer<typeof processEventsSchema>;
export type ApplyRetentionPoliciesDto = z.infer<typeof applyRetentionPoliciesSchema>;
export type RecalculateDataQualityDto = z.infer<typeof recalculateDataQualitySchema>;
