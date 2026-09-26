/**
 * @file Esquemas de entrada de la API de control QA.
 * @business Esta pieza rechaza en la frontera una corrida mal pedida, con el campo culpable.
 * @system Zod estricto: nada de campos que el contrato no conoce (un `tenantId` ajeno, un host).
 */
import { z } from 'zod';

const positiveInt = z.number().int().positive();

export const qaRunRequestSchema = z
  .object({
    templateCode: z.string().trim().min(2).max(120),
    templateVersion: z.string().trim().min(1).max(40),
    workflowCode: z.string().trim().min(2).max(120).optional(),
    environmentId: z.string().trim().min(2).max(80),
    mode: z.enum(['INTEGRATED_QA', 'MOCK_DIAGNOSTIC']).default('INTEGRATED_QA'),
    // Sin `.positive()` aquí a propósito: 0, -1 o 1.5 llegan al preflight y vuelven como bloqueo con
    // mensaje en vez de como un 400 genérico; el plan los rechaza igual y sin recortarlos.
    persons: z.number(),
    concurrency: z.number(),
    seed: z.string().trim().min(1).max(200),
    datasetMode: z.enum(['NORMAL_SYNTHETIC', 'INVALID', 'BOUNDARY', 'OUTCOMES', 'MIXED']).default('NORMAL_SYNTHETIC'),
    scenarioCode: z.string().trim().min(2).max(80),
    limits: z
      .object({ maxRequests: positiveInt, maxDurationMs: positiveInt, maxInFlightRequests: positiveInt })
      .partial()
      .strict()
      .optional(),
  })
  .strict();
export type QaRunRequestDto = z.infer<typeof qaRunRequestSchema>;

export const qaLaunchSchema = z.object({ planId: z.string().regex(/^\d+$/), planHash: z.string().regex(/^[0-9a-f]{64}$/) }).strict();
export type QaLaunchDto = z.infer<typeof qaLaunchSchema>;

export const qaIdempotencyKeySchema = z
  .string()
  .trim()
  .min(8)
  .max(120)
  .regex(/^[A-Za-z0-9._:-]+$/);

export const qaRunParamsSchema = z.object({ runId: z.string().regex(/^\d+$/) });
export type QaRunParamsDto = z.infer<typeof qaRunParamsSchema>;

export const qaPersonaParamsSchema = z.object({ runId: z.string().regex(/^\d+$/), personaKey: z.string().regex(/^p-\d{4,6}$/) });
export type QaPersonaParamsDto = z.infer<typeof qaPersonaParamsSchema>;

export const qaTemplateParamsSchema = z.object({ code: z.string().trim().min(2).max(120), version: z.string().trim().min(1).max(40) });
export type QaTemplateParamsDto = z.infer<typeof qaTemplateParamsSchema>;

export const qaWorkflowQuerySchema = z.object({ workflowCode: z.string().trim().min(2).max(120).optional() });
export type QaWorkflowQueryDto = z.infer<typeof qaWorkflowQuerySchema>;

export const qaRunsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  templateCode: z.string().trim().min(2).max(120).optional(),
  workflowCode: z.string().trim().min(2).max(120).optional(),
});
export type QaRunsQueryDto = z.infer<typeof qaRunsQuerySchema>;

export const qaPersonasQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  status: z.enum(['PENDING', 'RUNNING', 'PASSED', 'FAILED', 'BLOCKED', 'INDETERMINATE', 'CANCELLED']).optional(),
});
export type QaPersonasQueryDto = z.infer<typeof qaPersonasQuerySchema>;

export const qaEventsQuerySchema = z.object({ after: z.coerce.number().int().min(0).default(0) });
export type QaEventsQueryDto = z.infer<typeof qaEventsQuerySchema>;

export const qaSampleInputsSchema = z
  .object({
    seed: z.string().trim().min(1).max(200),
    count: z.number().int().min(1).max(5).default(5),
    datasetMode: z.enum(['NORMAL_SYNTHETIC', 'INVALID', 'BOUNDARY', 'OUTCOMES', 'MIXED']).default('NORMAL_SYNTHETIC'),
  })
  .strict();
export type QaSampleInputsDto = z.infer<typeof qaSampleInputsSchema>;
