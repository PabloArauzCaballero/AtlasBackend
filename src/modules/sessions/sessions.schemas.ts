import { z } from 'zod';

const positiveIdSchema = z.string().regex(/^[1-9][0-9]*$/, 'Debe ser un entero positivo representado como texto.');

const channelSchema = z.enum(['mobile_app', 'web_app', 'operations_panel', 'system']);

const deviceSnapshotSchema = z
  .object({
    brand: z.string().trim().max(100).optional(),
    model: z.string().trim().max(160).optional(),
    osFamily: z.string().trim().max(40).optional(),
    osVersion: z.string().trim().max(80).optional(),
    appVersion: z.string().trim().max(80).optional(),
    isRooted: z.boolean().optional(),
    isEmulator: z.boolean().optional(),
    vpnDetected: z.boolean().optional(),
  })
  .strict();

const gpsObservationSchema = z
  .object({
    lat: z.coerce.number().min(-90).max(90),
    lng: z.coerce.number().min(-180).max(180),
    accuracyMeters: z.coerce.number().min(0).max(10000).optional(),
    capturedAt: z.string().datetime().optional(),
  })
  .strict();

const permissionDecisionSchema = z
  .object({
    permissionCode: z.string().trim().min(1).max(80),
    granted: z.boolean(),
    decidedAt: z.string().datetime().optional(),
  })
  .strict();

const simObservationSchema = z
  .object({
    phoneNumberHash: z.string().trim().max(128).optional(),
    phoneLast4: z
      .string()
      .trim()
      .regex(/^[0-9]{4}$/)
      .optional(),
    carrierName: z.string().trim().max(80).optional(),
    simType: z.string().trim().max(40).optional(),
    simCount: z.coerce.number().int().min(0).max(10).optional(),
  })
  .strict();

const ipReputationSchema = z
  .object({
    isVpn: z.boolean().optional(),
    isProxy: z.boolean().optional(),
    isTor: z.boolean().optional(),
    countryCode: z.string().trim().length(2).optional(),
    city: z.string().trim().max(120).optional(),
    reputationScore: z.coerce.number().min(0).max(1).optional(),
  })
  .strict();

export const startSessionParamsSchema = z
  .object({
    customerId: positiveIdSchema,
  })
  .strict();

export const sessionParamsSchema = z
  .object({
    customerId: positiveIdSchema,
    sessionId: positiveIdSchema,
  })
  .strict();

export const operationSessionParamsSchema = z
  .object({
    sessionId: positiveIdSchema,
  })
  .strict();

export const startSessionSchema = z
  .object({
    device: z
      .object({
        deviceFingerprintHash: z.string().trim().min(8).max(180),
        fingerprintVersion: z.string().trim().min(1).max(60).default('v1'),
        channel: channelSchema.default('mobile_app'),
        userAgent: z.string().trim().max(1000).optional(),
        snapshot: deviceSnapshotSchema.optional(),
      })
      .strict(),
    authMethod: z.string().trim().min(1).max(60).default('app_session'),
    sessionTokenHash: z.string().trim().max(128).optional(),
    gpsObservation: gpsObservationSchema.optional(),
    permissions: z.array(permissionDecisionSchema).max(30).default([]),
    locationPermissionGranted: z.boolean().optional(),
    simObservation: simObservationSchema.optional(),
    ipReputation: ipReputationSchema.optional(),
  })
  .strict();

export const sessionHeartbeatSchema = z
  .object({
    deviceId: positiveIdSchema,
    clientHeartbeatId: z.string().trim().min(1).max(120),
    capturedAt: z.string().datetime().optional(),
    gpsObservation: gpsObservationSchema.optional(),
    permissionChanges: z.array(permissionDecisionSchema).max(30).default([]),
    locationPermissionGranted: z.boolean().optional(),
    deviceSnapshot: deviceSnapshotSchema.optional(),
    simObservation: simObservationSchema.optional(),
    ipReputation: ipReputationSchema.optional(),
  })
  .strict();

export const endSessionSchema = z
  .object({
    deviceId: positiveIdSchema.optional(),
    endedAt: z.string().datetime().optional(),
    reasonCode: z.string().trim().min(1).max(80).default('customer_logout'),
  })
  .strict();

export type StartSessionParamsDto = z.infer<typeof startSessionParamsSchema>;
export type SessionParamsDto = z.infer<typeof sessionParamsSchema>;
export type OperationSessionParamsDto = z.infer<typeof operationSessionParamsSchema>;
export type StartSessionDto = z.infer<typeof startSessionSchema>;
export type SessionHeartbeatDto = z.infer<typeof sessionHeartbeatSchema>;
export type EndSessionDto = z.infer<typeof endSessionSchema>;
