import {
  DeviceTokenModel,
  NotificationDeliveryModel,
  NotificationMessageModel,
  NotificationTemplateModel,
  UserNotificationPreferenceModel,
} from '../../database/models/index.js';

export function mapMessage(message: NotificationMessageModel): Record<string, unknown> {
  return {
    id: String(message.id),
    tenantId: message.tenantId === null ? null : String(message.tenantId),
    outboxEventId: message.outboxEventId === null ? null : String(message.outboxEventId),
    recipientType: message.recipientType,
    recipientId: message.recipientId,
    channel: message.channel,
    templateCode: message.templateCode,
    subject: message.subject,
    title: message.title,
    body: message.body,
    payload: message.payloadJson,
    status: message.status,
    priority: message.priority,
    category: message.category,
    icon: message.icon,
    scheduledAt: message.scheduledAt,
    queuedAt: message.queuedAt,
    sentAt: message.sentAt,
    deliveredAt: message.deliveredAt,
    readAt: message.readAt,
    failedAt: message.failedAt,
    cancelledAt: message.cancelledAt,
    correlationId: message.correlationId,
    causationId: message.causationId,
    createdAt: message.createdAtValue,
    updatedAt: message.updatedAtValue,
  };
}

export function mapTemplate(template: NotificationTemplateModel): Record<string, unknown> {
  return {
    id: String(template.id),
    tenantId: template.tenantId === null ? null : String(template.tenantId),
    code: template.code,
    channel: template.channel,
    locale: template.locale,
    titleTemplate: template.titleTemplate,
    subjectTemplate: template.subjectTemplate,
    bodyTemplate: template.bodyTemplate,
    payloadSchema: template.payloadSchemaJson,
    category: template.category,
    icon: template.icon,
    isActive: template.isActive,
    version: template.version,
    createdAt: template.createdAtValue,
    updatedAt: template.updatedAtValue,
  };
}

export function mapDelivery(delivery: NotificationDeliveryModel): Record<string, unknown> {
  return {
    id: String(delivery.id),
    notificationMessageId: String(delivery.notificationMessageId),
    channel: delivery.channel,
    provider: delivery.provider,
    providerMessageId: delivery.providerMessageId,
    status: delivery.status,
    attemptNumber: delivery.attemptNumber,
    errorCode: delivery.errorCode,
    errorMessage: delivery.errorMessage,
    sentAt: delivery.sentAt,
    deliveredAt: delivery.deliveredAt,
    failedAt: delivery.failedAt,
    createdAt: delivery.createdAtValue,
  };
}

export function mapPreference(preference: UserNotificationPreferenceModel): Record<string, unknown> {
  return {
    id: String(preference.id),
    customerId: String(preference.customerId),
    eventCode: preference.eventCode,
    channel: preference.channel,
    isEnabled: preference.isEnabled,
    isRequired: preference.isRequired,
    createdAt: preference.createdAtValue,
    updatedAt: preference.updatedAtValue,
  };
}

export function mapDeviceToken(deviceToken: DeviceTokenModel): Record<string, unknown> {
  return {
    id: String(deviceToken.id),
    customerId: String(deviceToken.customerId),
    platform: deviceToken.platform,
    deviceId: deviceToken.deviceId,
    isActive: deviceToken.isActive,
    lastSeenAt: deviceToken.lastSeenAt,
    createdAt: deviceToken.createdAtValue,
    updatedAt: deviceToken.updatedAtValue,
  };
}
