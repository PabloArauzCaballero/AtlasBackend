import { z } from 'zod';

export const notificationChannelSchema = z.enum(['in_app', 'push', 'email', 'sms', 'whatsapp', 'phone']);
export const notificationStatusSchema = z.enum([
  'pending',
  'queued',
  'sending',
  'sent',
  'delivered',
  'read',
  'failed',
  'retrying',
  'cancelled',
]);

export const listMessagesQuerySchema = z.object({
  status: notificationStatusSchema.optional(),
  channel: notificationChannelSchema.optional(),
  recipientType: z.string().trim().min(1).max(40).optional(),
  recipientId: z.string().trim().min(1).max(120).optional(),
  correlationId: z.string().trim().min(1).max(120).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
});

export const messageIdParamsSchema = z.object({
  messageId: z.string().regex(/^[1-9][0-9]*$/),
});

export const customerNotificationsParamsSchema = z.object({
  customerId: z.string().regex(/^[1-9][0-9]*$/),
});

export const customerNotificationIdParamsSchema = z.object({
  customerId: z.string().regex(/^[1-9][0-9]*$/),
  notificationId: z.string().regex(/^[1-9][0-9]*$/),
});

// Metadata libre para que un futuro frontend agrupe/etiquete notificaciones (ver migración
// 20260711130000-add-notification-category-icon). `category` es de texto libre a propósito (no
// enum): el catálogo de categorías crece con el tiempo (system_alert, billing, kyc, custom_
// broadcast, ...) y no queremos una migración de schema cada vez que se agregue una.
const notificationCategorySchema = z.string().trim().min(1).max(60);
const notificationIconSchema = z.string().trim().min(1).max(60);

export const createTemplateSchema = z.object({
  code: z.string().trim().min(3).max(160),
  channel: notificationChannelSchema,
  locale: z.string().trim().min(2).max(12).default('es-BO'),
  titleTemplate: z.string().trim().max(400).optional().nullable(),
  subjectTemplate: z.string().trim().max(400).optional().nullable(),
  bodyTemplate: z.string().trim().min(1).max(5000),
  payloadSchema: z.record(z.string(), z.unknown()).optional().nullable(),
  category: notificationCategorySchema.optional().nullable(),
  icon: notificationIconSchema.optional().nullable(),
  isActive: z.boolean().default(true),
  version: z.number().int().positive().default(1),
});

export const templateIdParamsSchema = z.object({
  templateId: z.string().regex(/^[1-9][0-9]*$/),
});

export const updateTemplateSchema = createTemplateSchema.partial();

export const listTemplatesQuerySchema = z.object({
  code: z.string().trim().min(1).max(160).optional(),
  channel: notificationChannelSchema.optional(),
  active: z.coerce.boolean().optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
});

export const preferencesParamsSchema = z.object({
  customerId: z.string().regex(/^[1-9][0-9]*$/),
});

export const updatePreferencesSchema = z.object({
  preferences: z
    .array(
      z.object({
        eventCode: z.string().trim().min(3).max(160),
        channel: notificationChannelSchema,
        isEnabled: z.boolean(),
        isRequired: z.boolean().default(false),
      }),
    )
    .min(1)
    .max(100),
});

export const customerNotificationsQuerySchema = z.object({
  status: notificationStatusSchema.optional(),
  channel: notificationChannelSchema.optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
});

export const upsertDeviceTokenSchema = z.object({
  platform: z.enum(['ios', 'android', 'web']),
  token: z.string().trim().min(8).max(500),
  deviceId: z.string().trim().max(180).optional().nullable(),
});

export const deviceTokenIdParamsSchema = z.object({
  customerId: z.string().regex(/^[1-9][0-9]*$/),
  deviceTokenId: z.string().regex(/^[1-9][0-9]*$/),
});

const positiveIdSchema = z.string().regex(/^[1-9][0-9]*$/);

export const broadcastAudienceSchema = z.enum(['customers', 'internal_users', 'both']);

/**
 * Notificación personalizada disparada por un admin (in-app, real — no hay "modo mock"). Si se
 * incluyen `customerIds`/`internalUserIds`, el envío se limita a esos destinatarios específicos;
 * si no, va a TODOS los customers/internal_users activos del tenant según `audience`. No hay un
 * campo "importance" separado a propósito: se reusa `priority` (ya existente en
 * notification_messages) tanto para orden de entrega como para importancia visible.
 */
export const createBroadcastNotificationSchema = z
  .object({
    title: z.string().trim().min(1).max(200),
    body: z.string().trim().min(1).max(2000),
    priority: z.coerce.number().int().min(0).max(100).default(0),
    category: notificationCategorySchema.default('custom_broadcast'),
    icon: notificationIconSchema.optional().nullable(),
    audience: broadcastAudienceSchema,
    customerIds: z.array(positiveIdSchema).min(1).max(5000).optional(),
    internalUserIds: z.array(positiveIdSchema).min(1).max(5000).optional(),
  })
  .refine((value) => value.audience !== 'internal_users' || !value.customerIds, {
    message: 'customerIds solo aplica cuando audience incluye customers.',
    path: ['customerIds'],
  })
  .refine((value) => value.audience !== 'customers' || !value.internalUserIds, {
    message: 'internalUserIds solo aplica cuando audience incluye internal_users.',
    path: ['internalUserIds'],
  });

export type ListMessagesQueryDto = z.infer<typeof listMessagesQuerySchema>;
export type MessageIdParamsDto = z.infer<typeof messageIdParamsSchema>;
export type CustomerNotificationsParamsDto = z.infer<typeof customerNotificationsParamsSchema>;
export type CustomerNotificationIdParamsDto = z.infer<typeof customerNotificationIdParamsSchema>;
export type CreateTemplateDto = z.infer<typeof createTemplateSchema>;
export type UpdateTemplateDto = z.infer<typeof updateTemplateSchema>;
export type ListTemplatesQueryDto = z.infer<typeof listTemplatesQuerySchema>;
export type PreferencesParamsDto = z.infer<typeof preferencesParamsSchema>;
export type UpdatePreferencesDto = z.infer<typeof updatePreferencesSchema>;
export type CustomerNotificationsQueryDto = z.infer<typeof customerNotificationsQuerySchema>;
export type UpsertDeviceTokenDto = z.infer<typeof upsertDeviceTokenSchema>;
export type DeviceTokenIdParamsDto = z.infer<typeof deviceTokenIdParamsSchema>;

export const internalUserNotificationIdParamsSchema = z.object({
  notificationId: positiveIdSchema,
});

export type BroadcastAudience = z.infer<typeof broadcastAudienceSchema>;
export type CreateBroadcastNotificationDto = z.infer<typeof createBroadcastNotificationSchema>;
export type InternalUserNotificationIdParamsDto = z.infer<typeof internalUserNotificationIdParamsSchema>;
