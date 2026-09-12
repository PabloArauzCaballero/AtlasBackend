/**
 * @file Contrato público de Mensajería: lo único que otro módulo puede ver (AT-017).
 * @business Un módulo pide «avisa a este cliente por este canal con esta plantilla» y recibe un
 *   identificador estable; no ve tablas, adaptadores ni transacciones de Mensajería.
 * @system Sólo valores serializables: cadenas, números, fechas ISO, objetos planos. Ni modelos ORM,
 *   ni opciones de consulta, ni clases de infraestructura (lo vigila `check:architecture`).
 */
export const NOTIFICATION_CHANNELS = ['in_app', 'push', 'email', 'sms', 'whatsapp', 'phone'] as const;
export type NotificationChannelCode = (typeof NOTIFICATION_CHANNELS)[number];

export const NOTIFICATION_RECIPIENT_TYPES = ['customer', 'merchant', 'internal_user', 'operations', 'system'] as const;
export type NotificationRecipientType = (typeof NOTIFICATION_RECIPIENT_TYPES)[number];

export type NotificationRequestInput = Readonly<{
  recipient: Readonly<{ type: NotificationRecipientType; id: string }>;
  channel: NotificationChannelCode;
  /** Código de plantilla del tenant; `null` para un mensaje literal (`title`/`body`). */
  templateCode: string | null;
  title: string | null;
  body: string;
  /** Datos de la plantilla. Serializable; sin PII que la plantilla no necesite. */
  payload: Readonly<Record<string, string | number | boolean | null>>;
  priority?: number;
  category?: string | null;
  /** Clave de deduplicación por tenant: el mismo valor devuelve el mismo `notificationId`. */
  dedupKey?: string | null;
  /** Fecha ISO 8601; `null` = cuanto antes. */
  scheduledAt?: string | null;
}>;

export type NotificationRequestContext = Readonly<{
  tenantId: string;
  correlationId: string | null;
  /** Evento de dominio que origina el aviso, si lo hay (identificador, no el modelo). */
  causationId?: string | null;
}>;

export type NotificationRequestResult = Readonly<{
  notificationId: string;
  accepted: boolean;
  /** Estado inicial del mensaje según Mensajería (`pending`, `queued`…). */
  status: string;
  /** Verdadero cuando `dedupKey` ya existía y se devolvió el mensaje anterior. */
  deduplicated: boolean;
}>;
