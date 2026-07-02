import { z } from 'zod';

export const telemetryCustomerParamsSchema = z.object({
  customerId: z.string().regex(/^[1-9][0-9]*$/),
});

const telemetryMetadataSchema = z.record(z.string(), z.unknown()).optional();

export const telemetryBatchSchema = z.object({
  sessionId: z.string().regex(/^[1-9][0-9]*$/),
  deviceId: z.string().regex(/^[1-9][0-9]*$/),
  clientBatchId: z.string().trim().min(3).max(120),
  capturedFrom: z.string().datetime(),
  capturedUntil: z.string().datetime(),
  events: z
    .array(
      z.object({
        eventType: z.enum([
          'form_field_interaction',
          'permission_event',
          'auth_event',
          'device_risk_event',
          'sim_observation',
          'ip_reputation_observation',
          'customer_observation',
          'customer_action',
          'onboarding_step_event',
        ]),
        eventCode: z.string().trim().min(1).max(120),
        occurredAt: z.string().datetime(),
        metadata: telemetryMetadataSchema,
      }),
    )
    .max(100)
    .default([]),
  onDeviceMetrics: z
    .array(
      z.object({
        metricCode: z.string().trim().min(1).max(120),
        value: z.union([z.number().finite(), z.string().max(500), z.boolean(), z.record(z.string(), z.unknown())]),
        computedAt: z.string().datetime().optional(),
        confidenceScore: z.number().min(0).max(1).optional(),
      }),
    )
    .max(100)
    .default([]),
});

export type TelemetryCustomerParamsDto = z.infer<typeof telemetryCustomerParamsSchema>;
export type TelemetryBatchDto = z.infer<typeof telemetryBatchSchema>;
