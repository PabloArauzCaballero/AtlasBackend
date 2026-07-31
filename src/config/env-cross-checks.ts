/**
 * @file Artefacto de soporte específico de esta carpeta.
 * @business Esta pieza evita operar con parámetros inseguros o ambiguos.
 * @system valida y compone configuración tipada al arrancar.
 */
import { z } from 'zod';
import { DEFAULT_JWT_SECRET, DEFAULT_NOTIFICATION_TOKEN_ENCRYPTION_KEY, type RawAppEnv } from './env.schema.js';

/**
 * Validaciones CRUZADAS del entorno: las que dependen de más de una variable a la vez y por eso no
 * caben en el esquema por campo (un provider que exige sus credenciales, producción que prohíbe los
 * secretos de ejemplo, un canal 'webhook' que necesita URL).
 *
 * Vive fuera de `env.schema.ts` porque son dos responsabilidades distintas: aquella declara QUÉ
 * variables existen y su forma; esta declara qué combinaciones son inválidas.
 */
export function applyEnvCrossChecks(data: RawAppEnv, ctx: z.RefinementCtx): void {
  function requireWhen(enabled: boolean, path: keyof typeof data, message: string): void {
    const value = data[path];
    if (enabled && (typeof value !== 'string' || value.trim().length === 0)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: [path], message });
    }
  }

  function requireWebhook(channelProvider: string, channelUrl: keyof typeof data, channelName: string): void {
    const channelSpecificUrl = data[channelUrl];
    if (channelProvider === 'webhook' && !channelSpecificUrl && !data.NOTIFICATION_WEBHOOK_URL) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [channelUrl],
        message: `${channelName} usa provider webhook. Configura ${String(channelUrl)} o NOTIFICATION_WEBHOOK_URL.`,
      });
    }
  }

  if (data.NODE_ENV === 'production' && data.JWT_ACCESS_TOKEN_SECRET === DEFAULT_JWT_SECRET) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['JWT_ACCESS_TOKEN_SECRET'],
      message: 'JWT_ACCESS_TOKEN_SECRET no puede ser el valor por defecto en producción. Configura una clave secreta segura.',
    });
  }

  if (data.NODE_ENV === 'production') {
    if (data.NOTIFICATION_TOKEN_ENCRYPTION_KEY === DEFAULT_NOTIFICATION_TOKEN_ENCRYPTION_KEY) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['NOTIFICATION_TOKEN_ENCRYPTION_KEY'],
        message: 'NOTIFICATION_TOKEN_ENCRYPTION_KEY no puede ser el valor de ejemplo en producción.',
      });
    }
    if (data.NOTIFICATION_TOKEN_ENCRYPTION_KEY === data.JWT_ACCESS_TOKEN_SECRET) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['NOTIFICATION_TOKEN_ENCRYPTION_KEY'],
        message: 'NOTIFICATION_TOKEN_ENCRYPTION_KEY debe ser distinto de JWT_ACCESS_TOKEN_SECRET en producción.',
      });
    }
  }

  if (data.NODE_ENV === 'production' && !data.REDIS_URL) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['REDIS_URL'],
      message: 'REDIS_URL es requerido en producción: sin Redis, el rate limiting solo protege por instancia.',
    });
  }

  // Hallazgo A-02: activar el escape hatch de mocks en producción es una decisión legítima solo para
  // una demo comercial, y entonces el servidor de mocks tiene que existir. Sin URL, cada proveedor en
  // `mock_server` fallaría con MOCK_BASE_URL_NOT_CONFIGURED y `mock_local` serviría datos inventados
  // desde el propio proceso: exactamente lo que el escape hatch pretende permitir a conciencia, pero
  // sin que nadie lo haya configurado a conciencia.
  if (data.NODE_ENV === 'production' && data.EXTERNAL_PROVIDERS_ALLOW_MOCK_IN_PRODUCTION && !data.EXTERNAL_PROVIDERS_MOCK_BASE_URL) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['EXTERNAL_PROVIDERS_MOCK_BASE_URL'],
      message:
        'EXTERNAL_PROVIDERS_ALLOW_MOCK_IN_PRODUCTION=true exige EXTERNAL_PROVIDERS_MOCK_BASE_URL. ' +
        'Si no querías servir datos simulados en producción, deja el flag en false.',
    });
  }

  if (data.NODE_ENV === 'production' && data.DB_SSL && !data.DB_SSL_REJECT_UNAUTHORIZED) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['DB_SSL_REJECT_UNAUTHORIZED'],
      message: 'DB_SSL_REJECT_UNAUTHORIZED debe permanecer activo en produccion para validar el certificado PostgreSQL.',
    });
  }

  requireWhen(
    Boolean(data.MAILSENDER_BASE_URL),
    'MAILSENDER_EXTERNAL_API_KEY',
    'MAILSENDER_EXTERNAL_API_KEY es requerido cuando MAILSENDER_BASE_URL está configurado.',
  );
  requireWhen(
    Boolean(data.MAILSENDER_BASE_URL),
    'MAILSENDER_ADMIN_USERNAME',
    'MAILSENDER_ADMIN_USERNAME es requerido cuando MAILSENDER_BASE_URL está configurado.',
  );
  requireWhen(
    Boolean(data.MAILSENDER_BASE_URL),
    'MAILSENDER_ADMIN_PASSWORD',
    'MAILSENDER_ADMIN_PASSWORD es requerido cuando MAILSENDER_BASE_URL está configurado.',
  );

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

  requireWebhook(data.NOTIFICATION_EMAIL_PROVIDER, 'NOTIFICATION_EMAIL_WEBHOOK_URL', 'Email');
  requireWebhook(data.NOTIFICATION_PUSH_PROVIDER, 'NOTIFICATION_PUSH_WEBHOOK_URL', 'Push');
  requireWebhook(data.NOTIFICATION_SMS_PROVIDER, 'NOTIFICATION_SMS_WEBHOOK_URL', 'SMS');
  requireWebhook(data.NOTIFICATION_WHATSAPP_PROVIDER, 'NOTIFICATION_WHATSAPP_WEBHOOK_URL', 'WhatsApp');
  requireWebhook(data.NOTIFICATION_PHONE_PROVIDER, 'NOTIFICATION_PHONE_WEBHOOK_URL', 'Phone');
}
