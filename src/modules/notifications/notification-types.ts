export type NotificationChannel = 'in_app' | 'push' | 'email' | 'sms' | 'whatsapp' | 'phone';
export type NotificationStatus = 'pending' | 'queued' | 'sending' | 'sent' | 'delivered' | 'read' | 'failed' | 'retrying' | 'cancelled';
export type DeliveryStatus = 'sent' | 'delivered' | 'failed' | 'skipped';
export type RecipientType = 'customer' | 'merchant' | 'internal_user' | 'operations' | 'system';

export type NotificationRule = {
  eventCode: string;
  channels: NotificationChannel[];
  recipientType: RecipientType;
  recipientIdPath?: string[];
  required?: boolean;
  templatePrefix?: string;
};

export type DeliveryTarget = { address: string; kind: 'email' | 'phone' | 'fcm_token' | 'whatsapp'; metadata?: Record<string, unknown> };

export type NotificationMessagePayload = {
  id: string;
  tenantId: string | null;
  recipientType: string;
  recipientId: string;
  channel: NotificationChannel;
  subject: string | null;
  title: string | null;
  body: string;
  payload: Record<string, unknown>;
  correlationId: string | null;
  deliveryTargets?: DeliveryTarget[];
};

export type DeliveryResult = {
  status: DeliveryStatus;
  provider: string;
  providerMessageId?: string | null;
  response?: Record<string, unknown> | null;
  errorCode?: string | null;
  errorMessage?: string | null;
};
