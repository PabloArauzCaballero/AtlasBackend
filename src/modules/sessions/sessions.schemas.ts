import { z } from 'zod';

export const createCustomerSessionSchema = z.object({
  deviceFingerprintHash: z.string().trim().min(32).max(128),
  fingerprintVersion: z.string().trim().min(1).max(40).default('v1'),
  channel: z.string().trim().min(1).max(40).default('mobile_app'),
  authMethod: z.string().trim().min(1).max(40).default('jwt'),
  userAgent: z.string().trim().max(500).optional(),
  gpsLat: z.number().min(-90).max(90).optional(),
  gpsLng: z.number().min(-180).max(180).optional(),
  gpsAccuracyMeters: z.number().min(0).max(50000).optional(),
  deviceSnapshot: z
    .object({
      brand: z.string().trim().max(80).optional(),
      model: z.string().trim().max(120).optional(),
      osFamily: z.string().trim().max(40).optional(),
      osVersion: z.string().trim().max(60).optional(),
      appVersion: z.string().trim().max(60).optional(),
      isRooted: z.boolean().optional(),
      isEmulator: z.boolean().optional(),
      vpnDetected: z.boolean().optional(),
    })
    .optional(),
});

export const sessionCustomerIdParamsSchema = z.object({
  customerId: z.string().regex(/^[1-9][0-9]*$/),
});

export const listCustomerSessionsQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
});

export type CreateCustomerSessionDto = z.infer<typeof createCustomerSessionSchema>;
export type SessionCustomerIdParamsDto = z.infer<typeof sessionCustomerIdParamsSchema>;
export type ListCustomerSessionsQueryDto = z.infer<typeof listCustomerSessionsQuerySchema>;
