/**
 * @file Artefacto de soporte específico de esta carpeta.
 * @business Esta pieza evita operar con parámetros inseguros o ambiguos.
 * @system valida y compone configuración tipada al arrancar.
 */
import { type RawAppEnv } from './env.schema.js';

/**
 * Validaciones cruzadas de los CANALES DE NOTIFICACIÓN: cada proveedor elegido exige su propio juego
 * de credenciales.
 *
 * Separadas de `env-cross-checks.ts` porque responden a una pregunta distinta —"¿esta integración
 * está completa?"— de la que responden las validaciones de seguridad de producción —"¿este
 * despliegue es seguro?"—, y porque son el bloque que crece cada vez que se añade un proveedor.
 * Mantenerlas juntas empujaba el archivo por encima del gate de tamaño en cada integración nueva.
 *
 * Un canal con proveedor elegido pero sin credenciales es el peor estado posible: el sistema cree
 * que puede enviar y falla en cada intento, en vez de decir de entrada que está apagado.
 */
export type RequireWhen = (enabled: boolean, path: keyof RawAppEnv, message: string) => void;
export type RequireWebhook = (channelProvider: string, channelUrl: keyof RawAppEnv, channelName: string) => void;

/** Email: cada proveedor trae su propio juego de credenciales. */
function checkEmailProvider(data: RawAppEnv, requireWhen: RequireWhen): void {
  requireWhen(
    data.NOTIFICATION_EMAIL_PROVIDER === 'resend',
    'RESEND_API_KEY',
    'RESEND_API_KEY es requerido cuando NOTIFICATION_EMAIL_PROVIDER=resend.',
  );
  requireWhen(
    data.NOTIFICATION_EMAIL_PROVIDER === 'resend',
    'RESEND_FROM_EMAIL',
    'RESEND_FROM_EMAIL es requerido cuando NOTIFICATION_EMAIL_PROVIDER=resend.',
  );
  requireWhen(
    data.NOTIFICATION_EMAIL_PROVIDER === 'sendgrid',
    'SENDGRID_API_KEY',
    'SENDGRID_API_KEY es requerido cuando NOTIFICATION_EMAIL_PROVIDER=sendgrid.',
  );
  requireWhen(
    data.NOTIFICATION_EMAIL_PROVIDER === 'sendgrid',
    'SENDGRID_FROM_EMAIL',
    'SENDGRID_FROM_EMAIL es requerido cuando NOTIFICATION_EMAIL_PROVIDER=sendgrid.',
  );
  requireWhen(
    data.NOTIFICATION_EMAIL_PROVIDER === 'gmail_api',
    'GMAIL_CLIENT_ID',
    'GMAIL_CLIENT_ID es requerido cuando NOTIFICATION_EMAIL_PROVIDER=gmail_api.',
  );
  requireWhen(
    data.NOTIFICATION_EMAIL_PROVIDER === 'gmail_api',
    'GMAIL_CLIENT_SECRET',
    'GMAIL_CLIENT_SECRET es requerido cuando NOTIFICATION_EMAIL_PROVIDER=gmail_api.',
  );
  requireWhen(
    data.NOTIFICATION_EMAIL_PROVIDER === 'gmail_api',
    'GMAIL_REFRESH_TOKEN',
    'GMAIL_REFRESH_TOKEN es requerido cuando NOTIFICATION_EMAIL_PROVIDER=gmail_api.',
  );
  requireWhen(
    data.NOTIFICATION_EMAIL_PROVIDER === 'gmail_api',
    'GMAIL_FROM_EMAIL',
    'GMAIL_FROM_EMAIL es requerido cuando NOTIFICATION_EMAIL_PROVIDER=gmail_api.',
  );
}

/** Push (FCM): las tres piezas de la cuenta de servicio de Firebase. */
function checkPushProvider(data: RawAppEnv, requireWhen: RequireWhen): void {
  requireWhen(
    data.NOTIFICATION_PUSH_PROVIDER === 'fcm',
    'FCM_PROJECT_ID',
    'FCM_PROJECT_ID es requerido cuando NOTIFICATION_PUSH_PROVIDER=fcm.',
  );
  requireWhen(
    data.NOTIFICATION_PUSH_PROVIDER === 'fcm',
    'FCM_CLIENT_EMAIL',
    'FCM_CLIENT_EMAIL es requerido cuando NOTIFICATION_PUSH_PROVIDER=fcm.',
  );
  requireWhen(
    data.NOTIFICATION_PUSH_PROVIDER === 'fcm',
    'FCM_PRIVATE_KEY',
    'FCM_PRIVATE_KEY es requerido cuando NOTIFICATION_PUSH_PROVIDER=fcm.',
  );
}

/** Twilio: SMS y WhatsApp comparten credenciales de cuenta, pero cada uno exige su remitente. */
function checkTwilioProviders(data: RawAppEnv, requireWhen: RequireWhen): void {
  requireWhen(
    data.NOTIFICATION_SMS_PROVIDER === 'twilio' || data.NOTIFICATION_WHATSAPP_PROVIDER === 'twilio',
    'TWILIO_ACCOUNT_SID',
    'TWILIO_ACCOUNT_SID es requerido cuando SMS o WhatsApp usan Twilio.',
  );
  requireWhen(
    data.NOTIFICATION_SMS_PROVIDER === 'twilio' || data.NOTIFICATION_WHATSAPP_PROVIDER === 'twilio',
    'TWILIO_AUTH_TOKEN',
    'TWILIO_AUTH_TOKEN es requerido cuando SMS o WhatsApp usan Twilio.',
  );
  requireWhen(
    data.NOTIFICATION_SMS_PROVIDER === 'twilio',
    'TWILIO_SMS_FROM',
    'TWILIO_SMS_FROM es requerido cuando NOTIFICATION_SMS_PROVIDER=twilio.',
  );
  requireWhen(
    data.NOTIFICATION_WHATSAPP_PROVIDER === 'twilio',
    'TWILIO_WHATSAPP_FROM',
    'TWILIO_WHATSAPP_FROM es requerido cuando NOTIFICATION_WHATSAPP_PROVIDER=twilio.',
  );
}

/** WhatsApp por Meta Cloud API. */
function checkMetaWhatsAppProvider(data: RawAppEnv, requireWhen: RequireWhen): void {
  requireWhen(
    data.NOTIFICATION_WHATSAPP_PROVIDER === 'meta_cloud',
    'META_WHATSAPP_TOKEN',
    'META_WHATSAPP_TOKEN es requerido cuando NOTIFICATION_WHATSAPP_PROVIDER=meta_cloud.',
  );
  requireWhen(
    data.NOTIFICATION_WHATSAPP_PROVIDER === 'meta_cloud',
    'META_WHATSAPP_PHONE_NUMBER_ID',
    'META_WHATSAPP_PHONE_NUMBER_ID es requerido cuando NOTIFICATION_WHATSAPP_PROVIDER=meta_cloud.',
  );
}

/** Cualquier canal en `webhook` necesita URL: la suya o la compartida. */
function checkWebhookUrls(data: RawAppEnv, requireWebhook: RequireWebhook): void {
  requireWebhook(data.NOTIFICATION_EMAIL_PROVIDER, 'NOTIFICATION_EMAIL_WEBHOOK_URL', 'Email');
  requireWebhook(data.NOTIFICATION_PUSH_PROVIDER, 'NOTIFICATION_PUSH_WEBHOOK_URL', 'Push');
  requireWebhook(data.NOTIFICATION_SMS_PROVIDER, 'NOTIFICATION_SMS_WEBHOOK_URL', 'SMS');
  requireWebhook(data.NOTIFICATION_WHATSAPP_PROVIDER, 'NOTIFICATION_WHATSAPP_WEBHOOK_URL', 'WhatsApp');
  requireWebhook(data.NOTIFICATION_PHONE_PROVIDER, 'NOTIFICATION_PHONE_WEBHOOK_URL', 'Phone');
}

/**
 * Cada canal de notificación con proveedor elegido exige sus credenciales. Un canal que dice estar
 * activo y falla en cada envío es peor que uno declarado `disabled`.
 */
export function checkNotificationProviders(data: RawAppEnv, requireWhen: RequireWhen, requireWebhook: RequireWebhook): void {
  checkEmailProvider(data, requireWhen);
  checkPushProvider(data, requireWhen);
  checkTwilioProviders(data, requireWhen);
  checkMetaWhatsAppProvider(data, requireWhen);
  checkWebhookUrls(data, requireWebhook);
}
