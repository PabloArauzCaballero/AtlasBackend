import 'dotenv/config';
import { z } from 'zod';

const DEFAULT_JWT_SECRET = 'dev-only-atlas-access-token-secret-change-me';
const DEFAULT_NOTIFICATION_TOKEN_ENCRYPTION_KEY = 'change-this-32-plus-character-key-for-device-tokens';

const optionalUrlEnvSchema = z.preprocess((value) => {
  if (typeof value === 'string' && value.trim() === '') return undefined;
  return value;
}, z.string().url().optional());

const optionalMongoUrlEnvSchema = z.preprocess(
  (value) => {
    if (typeof value === 'string' && value.trim() === '') return undefined;
    return value;
  },
  z
    .string()
    .regex(/^mongodb(\+srv)?:\/\//, 'Debe iniciar con mongodb:// o mongodb+srv://')
    .optional(),
);

const booleanEnvSchema = z
  .preprocess((value) => {
    if (typeof value !== 'string') {
      return value;
    }

    const normalized = value.trim().toLowerCase();

    if (['true', '1', 'yes', 'y', 'on'].includes(normalized)) {
      return true;
    }

    if (['false', '0', 'no', 'n', 'off', ''].includes(normalized)) {
      return false;
    }

    return value;
  }, z.boolean())
  .default(false);

const optionalBooleanEnvSchema = z
  .preprocess((value) => {
    if (typeof value !== 'string') return value;
    const normalized = value.trim().toLowerCase();
    if (['true', '1', 'yes', 'y', 'on'].includes(normalized)) return true;
    if (['false', '0', 'no', 'n', 'off', ''].includes(normalized)) return false;
    return value;
  }, z.boolean())
  .optional();

const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    APP_PORT: z.coerce.number().int().positive().default(3005),
    API_PREFIX: z.string().min(1).default('api/v1'),
    CORS_ORIGINS: z.string().default('http://localhost:3000,http://localhost:5273'),
    INTERNAL_FRONTEND_ORIGIN: z.string().url().default('http://localhost:5273'),
    DB_HOST: z.string().min(1).default('localhost'),
    DB_PORT: z.coerce.number().int().positive().default(5432),
    DB_NAME: z.string().min(1).default('atlas'),
    DB_USER: z.string().min(1).default('postgres'),
    DB_PASSWORD: z.string().default('postgres'),
    DB_SCHEMA: z.string().min(1).default('public'),
    DB_SSL: booleanEnvSchema,
    DB_SSL_REJECT_UNAUTHORIZED: booleanEnvSchema.default(true),

    // Limpieza previa a seeds. Por defecto está apagada. En producción exige doble confirmación
    // para evitar borrar datos reales por accidente. Preserva SequelizeMeta y limpia los datos
    // de aplicación para que los seeders vuelvan a poblar un entorno consistente.
    DATABASE_CLEAN_BEFORE_SEED: booleanEnvSchema,
    DATABASE_CLEAN_ALLOW_PRODUCTION: booleanEnvSchema,
    DATABASE_CLEAN_CONFIRM: z.string().optional(),
    JWT_ACCESS_TOKEN_SECRET: z.string().min(32).default(DEFAULT_JWT_SECRET),
    JWT_ACCESS_TOKEN_EXPIRES_IN: z.string().default('1h'),
    API_RATE_LIMIT_TTL_MS: z.coerce.number().int().positive().default(60_000),
    API_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(100),
    SYSTEM_TEST_ALLOWED_HOSTS_LOCAL: z.string().default('localhost,127.0.0.1,::1,host.docker.internal'),
    SYSTEM_TEST_ALLOWED_HOSTS_STAGING: z.string().default(''),
    SYSTEM_TEST_ALLOWED_HOSTS_PRODUCTION_READONLY: z.string().default(''),

    // ATLAS-AUDIT-023 (cerrado en este patch): rate limiting ahora puede respaldarse en Redis
    // para que el límite sea real cuando corre más de una instancia del backend (ver
    // `src/common/redis/redis.module.ts` y `src/common/throttler/redis-throttler-storage.ts`).
    // Si REDIS_URL no está configurado, el throttler cae a almacenamiento en memoria (correcto
    // solo para una única instancia); se exige explícitamente en producción más abajo.
    REDIS_URL: optionalUrlEnvSchema,

    // ATLAS-AUDIT-006: expone Swagger/OpenAPI en API_PREFIX/docs. Activado por defecto fuera
    // de producción; en producción debe activarse explícitamente y protegerse a nivel de
    // infraestructura (p. ej. restringido por IP/VPN), no queda expuesto públicamente por defecto.
    // Si no se define explícitamente, Swagger queda activo en desarrollo/test y apagado en
    // producción. Antes el default era true también en producción, contradiciendo el comentario
    // de seguridad del propio archivo.
    API_DOCS_ENABLED: optionalBooleanEnvSchema,

    AUTH_REFRESH_TOKEN_EXPIRES_IN_DAYS: z.coerce.number().int().positive().default(30),
    AUTH_MAX_FAILED_LOGIN_ATTEMPTS: z.coerce.number().int().positive().default(5),
    AUTH_LOCKOUT_MINUTES: z.coerce.number().int().positive().default(15),

    NOTIFICATION_EMAIL_PROVIDER: z.enum(['disabled', 'resend', 'sendgrid', 'gmail_api', 'webhook']).default('disabled'),
    NOTIFICATION_PUSH_PROVIDER: z.enum(['disabled', 'fcm', 'webhook']).default('disabled'),
    NOTIFICATION_SMS_PROVIDER: z.enum(['disabled', 'twilio', 'webhook']).default('disabled'),
    NOTIFICATION_WHATSAPP_PROVIDER: z.enum(['disabled', 'meta_cloud', 'twilio', 'webhook']).default('disabled'),
    NOTIFICATION_PHONE_PROVIDER: z.enum(['disabled', 'webhook']).default('disabled'),
    NOTIFICATION_WEBHOOK_URL: optionalUrlEnvSchema,
    NOTIFICATION_EMAIL_WEBHOOK_URL: optionalUrlEnvSchema,
    NOTIFICATION_PUSH_WEBHOOK_URL: optionalUrlEnvSchema,
    NOTIFICATION_SMS_WEBHOOK_URL: optionalUrlEnvSchema,
    NOTIFICATION_WHATSAPP_WEBHOOK_URL: optionalUrlEnvSchema,
    NOTIFICATION_PHONE_WEBHOOK_URL: optionalUrlEnvSchema,
    NOTIFICATION_PROVIDER_HTTP_TIMEOUT_MS: z.coerce.number().int().positive().max(60_000).default(15_000),
    NOTIFICATION_PROVIDER_HTTP_RETRIES: z.coerce.number().int().min(0).max(5).default(1),
    NOTIFICATION_PROVIDER_HTTP_RETRY_BASE_DELAY_MS: z.coerce.number().int().positive().max(10_000).default(250),
    NOTIFICATION_PUSH_INCLUDE_VISIBLE_NOTIFICATION: booleanEnvSchema,
    NOTIFICATION_DEFAULT_LOCALE: z.string().min(2).default('es-BO'),
    RESEND_API_KEY: z.string().optional(),
    RESEND_FROM_EMAIL: z.string().optional(),
    SENDGRID_API_KEY: z.string().optional(),
    SENDGRID_FROM_EMAIL: z.string().optional(),
    GMAIL_CLIENT_ID: z.string().optional(),
    GMAIL_CLIENT_SECRET: z.string().optional(),
    GMAIL_REFRESH_TOKEN: z.string().optional(),
    GMAIL_FROM_EMAIL: z.string().optional(),
    FCM_PROJECT_ID: z.string().optional(),
    FCM_CLIENT_EMAIL: z.string().optional(),
    FCM_PRIVATE_KEY: z.string().optional(),
    TWILIO_ACCOUNT_SID: z.string().optional(),
    TWILIO_AUTH_TOKEN: z.string().optional(),
    TWILIO_SMS_FROM: z.string().optional(),
    TWILIO_WHATSAPP_FROM: z.string().optional(),
    META_WHATSAPP_TOKEN: z.string().optional(),
    META_WHATSAPP_PHONE_NUMBER_ID: z.string().optional(),
    META_WHATSAPP_DEFAULT_TEMPLATE_NAME: z.string().optional(),
    META_WHATSAPP_DEFAULT_TEMPLATE_LANGUAGE: z.string().default('es'),
    NOTIFICATION_TOKEN_ENCRYPTION_KEY: z.string().min(32).default(DEFAULT_NOTIFICATION_TOKEN_ENCRYPTION_KEY),

    // ATLAS-P11-T13: opcionales a propósito. Si ambos están presentes, el bootstrap registra
    // `KmsKeyProvider` como proveedor disponible para `envelope-encryption.util.ts` (ver
    // `src/main.ts`). Esto NO activa el cifrado de PII con KMS automáticamente — los call sites
    // reales (`customer-onboarding.service.ts`, `notifications.repository.ts`) siguen usando
    // `encryptSecretEnvelope()` con su proveedor `local` por defecto hasta que se decida migrar
    // esos call sites a una firma async con KMS de verdad (ver la nota de alcance en
    // `envelope-encryption.util.ts`). Dejar esto sin configurar es válido y es el default seguro.
    KMS_KEY_ID: z.string().min(1).optional(),
    AWS_REGION: z.string().min(1).optional(),

    MONGO_DB_URL_CONNECTION: optionalMongoUrlEnvSchema,
    MONGO_LOGS_DB_NAME: z.string().min(1).default('atlas_logs'),
    MONGO_LOGS_COLLECTION: z.string().min(1).default('archivo_log_updates'),
    LOG_SYNC_FILE_PATH: z.string().min(1).default('Archivo.log'),
    LOG_SYNC_INTERVAL_MS: z.coerce.number().int().positive().default(5_000),
    LOG_SYNC_MAX_CHUNK_BYTES: z.coerce.number().int().positive().max(10_000_000).default(1_000_000),
    LOG_SYNC_IMPORT_EXISTING_ON_FIRST_BOOT: booleanEnvSchema,
    LOG_SYNC_MONGO_SERVER_SELECTION_TIMEOUT_MS: z.coerce.number().int().positive().max(60_000).default(5_000),
    LOG_SYNC_FAILURES_BEFORE_PAUSE: z.coerce.number().int().positive().max(20).default(3),
    LOG_SYNC_FAILURE_PAUSE_MS: z.coerce.number().int().positive().max(3_600_000).default(60_000),

    // Monitor de salud de herramientas críticas (systems-ops): chequea periódicamente
    // SystemsHealthService.getToolsHealth() y notifica a los usuarios internos (in-app) cuando
    // una herramienta marcada `isCritical` pasa de saludable a no-saludable (y cuando se
    // recupera). Activado por defecto; se puede apagar en un entorno donde no tenga sentido
    // (p. ej. un ambiente de pruebas efímero) sin tocar código.
    SYSTEM_HEALTH_MONITOR_ENABLED: optionalBooleanEnvSchema.default(true),
    SYSTEM_HEALTH_MONITOR_INTERVAL_MS: z.coerce.number().int().positive().max(3_600_000).default(60_000),
  })
  .superRefine((data, ctx) => {
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
        message:
          'REDIS_URL es requerido en producción (ATLAS-AUDIT-023): sin Redis, el rate limiting solo protege por instancia y dejará de ser confiable en cuanto se despliegue más de una tarea de ECS Fargate.',
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
  });

type RawAppEnv = z.infer<typeof envSchema>;
export type AppEnv = Omit<RawAppEnv, 'API_DOCS_ENABLED'> & { API_DOCS_ENABLED: boolean };

function parseEnv(): AppEnv {
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const details = parsed.error.issues.map((issue) => `- ${issue.path.join('.') || 'ENV'}: ${issue.message}`).join('\n');
    throw new Error(
      `Configuración de entorno inválida para ATLAS.\n${details}\n\n` +
        'Para desarrollo local usa `yarn start:dev` y asegúrate de que NODE_ENV=development en tu .env. ' +
        'Para producción configura REDIS_URL y secretos reales, no los valores de ejemplo.',
    );
  }

  return {
    ...parsed.data,
    API_DOCS_ENABLED: parsed.data.API_DOCS_ENABLED ?? parsed.data.NODE_ENV !== 'production',
  };
}

export const env: AppEnv = parseEnv();

export function getAllowedCorsOrigins(): string[] {
  return [...new Set([...env.CORS_ORIGINS.split(','), env.INTERNAL_FRONTEND_ORIGIN])]
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);
}
