/**
 * @file Artefacto de soporte específico de esta carpeta.
 * @business Esta pieza evita operar con parámetros inseguros o ambiguos.
 * @system valida y compone configuración tipada al arrancar.
 */
import { z } from 'zod';
import {
  booleanEnvSchema,
  optionalBooleanEnvSchema,
  optionalMongoUrlEnvSchema,
  optionalNonEmptyStringEnvSchema,
  optionalUrlEnvSchema,
} from './env.primitives.js';
import { databaseEnvShape } from './env.database.schema.js';
import { runtimeJobsEnvShape } from './env.runtime-jobs.schema.js';

export const DEFAULT_JWT_SECRET = 'dev-only-atlas-access-token-secret-change-me';
export const DEFAULT_NOTIFICATION_TOKEN_ENCRYPTION_KEY = 'change-this-32-plus-character-key-for-device-tokens';

export const envBaseSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),

  // Rol de ESTE proceso. Un mismo artefacto se despliega como API, como worker o como ambos:
  //   api    → atiende HTTP; no arranca ningún trabajo de fondo.
  //   worker → no monta la API de negocio; ejecuta el trabajo de fondo y expone sólo sonda y métricas.
  //   all    → ambas cosas (el comportamiento histórico y el default, para dev, tests y despliegues
  //            de una sola pieza: sin configurar nada, nada cambia).
  // Ver docs/architecture/background-processing.md.
  APP_ROLE: z.enum(['api', 'worker', 'all']).default('all'),
  APP_PORT: z.coerce.number().int().positive().default(3005),

  // Puerto de la sonda del worker (`/health/liveness`, `/health/readiness`, `/metrics`). Es un
  // puerto distinto del de la API porque en un despliegue de una sola máquina ambos procesos
  // conviven, y porque así el manifiesto puede publicar uno sin publicar el otro.
  WORKER_PROBE_PORT: z.coerce.number().int().positive().default(3006),
  API_PREFIX: z.string().min(1).default('api/v1'),
  API_JSON_BODY_LIMIT: z
    .string()
    .regex(/^\d+(kb|mb)$/i, 'Debe usar un limite como 512kb o 2mb.')
    .default('2mb'),
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

  // Pool de conexiones Sequelize. Sin estas vars, Sequelize aplica su default `max: 5`, que se
  // queda corto frente a la concurrencia real del backend (p.ej. el fan-out de notificaciones
  // asume ~25 entregas simultáneas). Dimensionar de modo que (instancias × DB_POOL_MAX) no supere
  // el CONNECTION LIMIT del rol atlas_app_rw en Postgres. Ver docs/database/postgres-roles.md.
  DB_POOL_MAX: z.coerce.number().int().positive().max(200).default(20),
  DB_POOL_MIN: z.coerce.number().int().min(0).max(100).default(2),
  DB_POOL_ACQUIRE_MS: z.coerce.number().int().positive().max(120_000).default(30_000),
  DB_POOL_IDLE_MS: z.coerce.number().int().positive().max(120_000).default(10_000),
  DB_READ_POOL_MAX: z.coerce.number().int().positive().max(200).default(10),

  // Techos del lado del SERVIDOR para una sesión de Postgres. `REQUEST_TIMEOUT_MS` corta el
  // Observable del request, pero no cancela la consulta: el socket sigue esperando y la conexión
  // del pool sigue ocupada. Sólo Postgres puede abortar su propio trabajo, y estas dos opciones son
  // el mecanismo para pedírselo.
  //
  //   DB_STATEMENT_TIMEOUT_MS               → aborta una sentencia que excede el plazo.
  //   DB_IDLE_IN_TRANSACTION_TIMEOUT_MS     → aborta una transacción ABIERTA pero inactiva (el caso
  //                                           en que el cliente murió a mitad y dejó locks tomados).
  //
  // Se aplican a los pools de escritura y lectura del RUNTIME, nunca a la conexión de migraciones
  // (un DDL/backfill legítimo puede durar mucho más). `0` desactiva cada techo, que es el
  // comportamiento previo. El de statement debe ser mayor que REQUEST_TIMEOUT_MS: la petición
  // debería rendirse antes de que la base mate la consulta, para que el 503 sea del servicio.
  DB_STATEMENT_TIMEOUT_MS: z.coerce.number().int().min(0).max(600_000).default(60_000),
  DB_IDLE_IN_TRANSACTION_TIMEOUT_MS: z.coerce.number().int().min(0).max(600_000).default(60_000),

  // Techo del ping de Postgres del readiness probe. Sin él, `sequelize.authenticate()` queda a
  // merced del `acquire` del pool (30 s por defecto): con el pool agotado, cada sondeo se cuelga y
  // retiene un turno de la cola, de modo que el propio probe agrava la saturación que debía
  // detectar. Redis ya tenía este techo; Postgres no.
  HEALTH_DB_PING_TIMEOUT_MS: z.coerce.number().int().positive().max(30_000).default(2_000),

  ...databaseEnvShape,

  JWT_ACCESS_TOKEN_SECRET: z.string().min(32).default(DEFAULT_JWT_SECRET),
  JWT_ACCESS_TOKEN_EXPIRES_IN: z.string().default('1h'),
  // Emisor y audiencia del token de acceso (hallazgo A-08 de
  // docs/audit/auditoria-integral-2026-07-30.md). Acotan para QUÉ vale un token firmado con
  // JWT_ACCESS_TOKEN_SECRET, de modo que otro token firmado con el mismo secreto para otro
  // propósito no sea aceptable como sesión. Cambiarlos invalida los tokens de acceso vigentes
  // (los refresh tokens son opacos y no se ven afectados).
  JWT_ISSUER: z.string().min(1).default('atlas-backend'),
  JWT_AUDIENCE: z.string().min(1).default('atlas-api'),
  API_RATE_LIMIT_TTL_MS: z.coerce.number().int().positive().default(60_000),
  API_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(100),
  SYSTEM_TEST_ALLOWED_HOSTS_LOCAL: z.string().default('localhost,127.0.0.1,::1,host.docker.internal'),
  SYSTEM_TEST_ALLOWED_HOSTS_STAGING: z.string().default(''),
  SYSTEM_TEST_ALLOWED_HOSTS_PRODUCTION_READONLY: z.string().default(''),

  // Redis respalda el rate limiting distribuido cuando hay más de una instancia.
  REDIS_URL: optionalUrlEnvSchema,

  // Swagger/OpenAPI queda activo fuera de producción; en producción requiere activación explícita.
  API_DOCS_ENABLED: optionalBooleanEnvSchema,

  AUTH_REFRESH_TOKEN_EXPIRES_IN_DAYS: z.coerce.number().int().positive().default(30),
  AUTH_MAX_FAILED_LOGIN_ATTEMPTS: z.coerce.number().int().positive().default(5),
  AUTH_LOCKOUT_MINUTES: z.coerce.number().int().positive().default(15),

  /**
   * Cookies de sesión del panel interno. Los tokens viajan en cookies `HttpOnly` para que un XSS
   * en el portal no pueda leerlos.
   *
   * `lax` es correcto aunque portal (5273) y API (3005) sean orígenes distintos: SameSite se
   * decide por dominio registrable, no por puerto, así que son el mismo site. Solo hay que pasar
   * a `none` (que exige `Secure`) si se despliegan en dominios distintos — y en ese caso SameSite
   * deja de proteger contra CSRF por sí solo.
   */
  AUTH_COOKIE_SAMESITE: z.enum(['lax', 'strict', 'none']).default('lax'),
  AUTH_COOKIE_DOMAIN: z.string().optional(),
  /** Sin valor explícito se activa en producción y se apaga en desarrollo (http://localhost). */
  AUTH_COOKIE_SECURE: optionalBooleanEnvSchema,

  // Códigos de un solo uso (reset de contraseña y PIN de login de administradores).
  // El PIN de super admin solo se exige cuando AUTH_LOGIN_PIN_ENABLED=true Y MailSender está
  // configurado: sin servicio de correo no hay forma de entregar el PIN y exigirlo dejaría a
  // los administradores sin acceso.
  AUTH_LOGIN_PIN_ENABLED: optionalBooleanEnvSchema.default(true),
  AUTH_ONE_TIME_CODE_TTL_MINUTES: z.coerce.number().int().positive().max(60).default(10),
  AUTH_ONE_TIME_CODE_MAX_ATTEMPTS: z.coerce.number().int().positive().max(10).default(5),

  // Integración con MailSender (microservicio de mensajería transaccional, proyecto hermano).
  // MAILSENDER_BASE_URL vacío = integración apagada. Cuando está configurado, se exigen la
  // API key externa (envíos) y las credenciales administrativas (auto-provisión de plantillas).
  MAILSENDER_BASE_URL: optionalUrlEnvSchema,
  MAILSENDER_API_PREFIX: z.string().default('/api/v1'),
  MAILSENDER_EXTERNAL_API_KEY: z.string().optional(),
  MAILSENDER_ADMIN_USERNAME: z.string().optional(),
  MAILSENDER_ADMIN_PASSWORD: z.string().optional(),

  // Trabajo de fondo: planificador, intervalos y modo de entrega de notificaciones.
  // Bloque propio en env.runtime-jobs.schema.ts — ver docs/architecture/background-processing.md.
  ...runtimeJobsEnvShape,

  // Proveedores externos (KYC, buró, telco, banca, confianza digital). El modo EFECTIVO de cada uno
  // sale de la base (`external_data_providers.default_mode`) o del override `${CODE}_MODE`; estas dos
  // variables gobiernan qué pasa cuando ese modo es simulado.
  //
  // EXTERNAL_PROVIDERS_MOCK_BASE_URL: URL del servidor de mocks (repo AtlasExternalProvidersMock).
  // Fuera de producción cae a http://localhost:4010/mock; en producción no tiene default.
  //
  // EXTERNAL_PROVIDERS_ALLOW_MOCK_IN_PRODUCTION: escape hatch. Con `false` (el default), en
  // producción un proveedor en modo `mock_local`/`mock_server` queda BLOQUEADO
  // (PROVIDER_UNAVAILABLE) en vez de servir evidencia inventada que acabaría persistida como
  // features del cliente y alimentando el motor de riesgo. Ver hallazgo A-02 de
  // docs/audit/auditoria-integral-2026-07-30.md.
  EXTERNAL_PROVIDERS_MOCK_BASE_URL: optionalUrlEnvSchema,
  EXTERNAL_PROVIDERS_ALLOW_MOCK_IN_PRODUCTION: booleanEnvSchema,

  // Escaneo antimalware de la evidencia (clamd por TCP). Vacío = apagado (solo desarrollo).
  MALWARE_SCAN_HOST: z.string().optional(),
  MALWARE_SCAN_PORT: z.coerce.number().int().positive().max(65535).optional(),
  MALWARE_SCAN_TIMEOUT_MS: z.coerce.number().int().positive().max(120_000).default(20_000),
  MALWARE_SCAN_FAIL_CLOSED: booleanEnvSchema.default(true),

  // Almacenamiento de evidencia (compatible con S3). Vacío = apagado: los endpoints responden 503
  // en vez de aceptar un `storageKey` que nadie puede verificar.
  STORAGE_S3_ENDPOINT: optionalUrlEnvSchema,
  STORAGE_S3_BUCKET: z.string().optional(),
  STORAGE_S3_REGION: z.string().default('us-east-1'),
  STORAGE_S3_ACCESS_KEY_ID: z.string().optional(),
  STORAGE_S3_SECRET_ACCESS_KEY: z.string().optional(),
  // MinIO y compatibles requieren el bucket en la ruta; AWS acepta ambos estilos.
  STORAGE_S3_FORCE_PATH_STYLE: booleanEnvSchema.default(true),
  STORAGE_UPLOAD_URL_TTL_SECONDS: z.coerce.number().int().positive().max(3600).default(300),

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

  // Opcionales a propósito. Si AMBOS están presentes, `main.ts` ACTIVA `KmsKeyProvider` como
  // proveedor de cifrado de envelope encryption (Fase 3.3 del plan 10/10): a partir de ahí las
  // escrituras nuevas de PII (`customer-onboarding`, `notifications.repository.ts`) se cifran con
  // data keys de AWS KMS real, sin cambiar los call sites — `encryptSecretEnvelope()` toma el
  // proveedor activo. Los valores previos cifrados con `local` se siguen descifrando. Requiere
  // que `@aws-sdk/client-kms` esté instalado en la imagen. Dejar esto sin configurar es válido y
  // deja el proveedor activo en `local`, el default seguro para dev/test.
  KMS_KEY_ID: z.string().min(1).optional(),
  AWS_REGION: z.string().min(1).optional(),

  MONGO_DB_URL_CONNECTION: optionalMongoUrlEnvSchema,
  MONGO_LOGS_DB_NAME: z.string().min(1).default('atlas_logs'),
  MONGO_LOGS_COLLECTION: z.string().min(1).default('archivo_log_updates'),
  // Ciclo de vida del proceso (hallazgo A-07 de docs/audit/auditoria-integral-2026-07-30.md).
  // SHUTDOWN_DRAIN_MS: al recibir SIGTERM, readiness pasa a 503 y se espera este tiempo antes de
  // cerrar, para que el balanceador retire la instancia sin cortar peticiones en curso. Debe ser
  // mayor que el intervalo del readiness probe del orquestador. `0` lo desactiva (dev/tests).
  // REQUEST_TIMEOUT_MS: techo de duración de cualquier petición HTTP; sin él, un handler colgado
  // retiene su conexión del pool indefinidamente. `0` lo desactiva.
  SHUTDOWN_DRAIN_MS: z.coerce.number().int().min(0).max(120_000).default(0),
  REQUEST_TIMEOUT_MS: z.coerce.number().int().min(0).max(600_000).default(30_000),

  // Identidad del artefacto desplegado, inyectada por el pipeline al construir la imagen. Sin ella,
  // `/health` no puede decir qué build está corriendo (hallazgo A-05 de
  // docs/audit/auditoria-integral-2026-07-30.md).
  // Metadatos del build. Se tratan con `optionalNonEmptyStringEnvSchema` y no con `.min(1).optional()`
  // porque un `ARG` de Docker no declarado se convierte en `ENV VAR=""`, no en "variable ausente":
  // con `.min(1)` eso rompia el arranque de CUALQUIER contenedor construido sin `--build-arg`, que es
  // exactamente el caso de un build local. Una cadena vacia significa "el pipeline no lo inyecto",
  // que es justo el caso que `build-info.ts` ya sabe degradar.
  APP_VERSION: optionalNonEmptyStringEnvSchema,
  APP_COMMIT_SHA: optionalNonEmptyStringEnvSchema,
  APP_BUILT_AT: optionalNonEmptyStringEnvSchema,

  // Formato de la salida por CONSOLA (stdout). `json` emite una línea JSON por evento, con
  // correlationId/traceId y la MISMA redacción de PII que ya se aplicaba al archivo; `pretty`
  // mantiene el formato humano de ConsoleLogger. Sin valor explícito, producción usa `json` (stdout
  // es el pipeline de logs real en contenedores) y el resto `pretty`. Ver hallazgo A-04 de
  // docs/audit/auditoria-integral-2026-07-30.md.
  LOG_FORMAT: z.enum(['json', 'pretty']).optional(),
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
});

/** Forma cruda del entorno tal como sale del esquema, antes de los defaults derivados. */
export type RawAppEnv = z.infer<typeof envBaseSchema>;
