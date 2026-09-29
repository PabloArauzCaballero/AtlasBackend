/**
 * @file Esquemas Zod: validan entradas y parámetros en el borde del sistema.
 * @business Esta pieza ofrece a operaciones una vista gobernada del negocio sin acceso directo a tablas sensibles.
 * @system compone consultas read-only, reportes, glosario, linaje y búsqueda para el portal administrativo.
 */
import { z } from 'zod';

const page = z.coerce.number().int().min(1).default(1);
const limit = z.coerce.number().int().min(1).max(100).default(20);
const textFilter = z.string().trim().min(1).max(120).optional();
const fields = z
  .string()
  .trim()
  .regex(/^[a-z][A-Za-z0-9]*(,[a-z][A-Za-z0-9]*)*$/, 'fields debe ser una lista CSV de nombres camelCase.')
  .transform((value) => [...new Set(value.split(','))])
  .optional();

const baseListShape = { page, limit, fields };

/*
 * `q` en TODAS las vistas: antes sólo «Clientes» lo declaraba y, como los esquemas son `.strict()`,
 * mandarlo a otra vista era un 400; la pantalla deshabilitaba el buscador en seis de siete vistas.
 * Las columnas donde busca cada una están en `admin-read.views.ts` (`search`).
 */

export const customerViewQuerySchema = z
  .object({
    ...baseListShape,
    q: textFilter,
    status: textFilter,
    riskBand: textFilter,
  })
  .strict();

export const riskViewQuerySchema = z
  .object({
    ...baseListShape,
    q: textFilter,
    customerId: z.coerce.number().int().positive().optional(),
    status: textFilter,
    riskBand: textFilter,
    decision: textFilter,
  })
  .strict();

export const workQueueViewQuerySchema = z
  .object({
    ...baseListShape,
    q: textFilter,
    type: textFilter,
    status: textFilter,
    priority: textFilter,
    severity: textFilter,
    assignedTo: z.coerce.number().int().positive().optional(),
  })
  .strict();

export const providerHealthViewQuerySchema = z
  .object({
    ...baseListShape,
    q: textFilter,
    healthStatus: textFilter,
    providerStatus: textFilter,
  })
  .strict();

export const notificationViewQuerySchema = z
  .object({
    ...baseListShape,
    q: textFilter,
    status: textFilter,
    channel: textFilter,
    category: textFilter,
  })
  .strict();

export const endpointCoverageViewQuerySchema = z
  .object({
    ...baseListShape,
    q: textFilter,
    module: textFilter,
    riskLevel: textFilter,
    reviewStatus: textFilter,
    releaseReady: z
      .enum(['true', 'false'])
      .transform((value) => value === 'true')
      .optional(),
  })
  .strict();

export const auditEventViewQuerySchema = z
  .object({
    ...baseListShape,
    q: textFilter,
    eventType: textFilter,
    actorType: textFilter,
    targetType: textFilter,
  })
  .strict();

export const governedViewParamSchema = z
  .object({
    view: z.enum([
      'customers',
      'risk-assessments',
      'work-queue',
      'provider-health',
      'notification-deliveries',
      'endpoint-coverage',
      'audit-events',
    ]),
  })
  .strict();

export type GovernedViewParamDto = z.infer<typeof governedViewParamSchema>;
export type CustomerViewQueryDto = z.infer<typeof customerViewQuerySchema>;
export type RiskViewQueryDto = z.infer<typeof riskViewQuerySchema>;
export type WorkQueueViewQueryDto = z.infer<typeof workQueueViewQuerySchema>;
export type ProviderHealthViewQueryDto = z.infer<typeof providerHealthViewQuerySchema>;
export type NotificationViewQueryDto = z.infer<typeof notificationViewQuerySchema>;
export type EndpointCoverageViewQueryDto = z.infer<typeof endpointCoverageViewQuerySchema>;
export type AuditEventViewQueryDto = z.infer<typeof auditEventViewQuerySchema>;
