import { z } from 'zod';

export const eventStatusSchema = z.enum(['pending', 'processing', 'processed', 'failed', 'cancelled']);

export const publishEventSchema = z.object({
  eventCode: z.string().trim().min(3).max(160),
  aggregateType: z.string().trim().min(2).max(120),
  aggregateId: z.string().trim().max(120).optional().nullable(),
  payload: z.record(z.string(), z.unknown()).default({}),
  metadata: z.record(z.string(), z.unknown()).default({}),
  priority: z.number().int().min(0).max(1000).optional(),
  availableAt: z.coerce.date().optional(),
  maxAttempts: z.number().int().positive().max(10).default(3),
  idempotencyKey: z.string().trim().min(8).max(180).optional(),
  correlationId: z.string().trim().max(120).optional().nullable(),
  causationId: z.string().trim().max(120).optional().nullable(),
  sourceModule: z.string().trim().max(120).optional().nullable(),
  sourceAction: z.string().trim().max(120).optional().nullable(),
});

export const listEventsQuerySchema = z.object({
  status: eventStatusSchema.optional(),
  eventCode: z.string().trim().min(1).max(160).optional(),
  aggregateType: z.string().trim().min(1).max(120).optional(),
  correlationId: z.string().trim().min(1).max(120).optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
  // ATLAS-AUDIT-025: modo de paginación alternativo por cursor (keyset), recomendado sobre
  // `page`/`OFFSET` para consultas profundas en tablas de alto crecimiento como `outbox_events`.
  // Retrocompatible: si se omite, el comportamiento existente por `page` no cambia.
  pagination: z.enum(['offset', 'cursor']).optional().default('offset'),
  cursor: z.string().trim().max(500).optional(),
});

export const eventIdParamsSchema = z.object({
  eventId: z.string().regex(/^[1-9][0-9]*$/),
});

export const processEventsSchema = z.object({
  limit: z.number().int().positive().max(500).default(50),
  dryRun: z.boolean().default(true),
});

export type PublishEventDto = z.infer<typeof publishEventSchema>;
export type ListEventsQueryDto = z.infer<typeof listEventsQuerySchema>;
export type EventIdParamsDto = z.infer<typeof eventIdParamsSchema>;
export type ProcessEventsDto = z.infer<typeof processEventsSchema>;
