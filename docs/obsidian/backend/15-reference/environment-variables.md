---
title: "Variables de entorno"
type: "reference"
status: "verified"
owner: "unknown"
criticality: "critical"
last_reviewed: "2026-08-06"
source_revision: "80fc741"
tags:
  - "backend"
  - "reference"
  - "configuration"
source_files:
  - "src/config/env.schema.ts"
  - "src/config/env.database.schema.ts"
  - "src/config/env.runtime-jobs.schema.ts"
  - "src/config/env-cross-checks.ts"
---
# Variables de entorno

**159 variables** validadas con Zod al arrancar. `.env.example` documenta 208 nombres.

> [!danger] Nunca se documentan valores reales
> Esta tabla lista **nombres, tipos y defaults del código**. Los valores de producción viven fuera del repositorio. El gate `yarn check:no-env-file` impide versionar `.env`.

> [!info] Verificado — fallo al arrancar, no en runtime
> `parseEnv()` en [`src/config/env.ts:19-57`](../../../src/config/env.ts) hace `safeParse` del entorno y **lanza** con el detalle por campo si algo no valida. Una variable mal puesta impide el arranque en vez de degradar el servicio a mitad de camino. Las validaciones cruzadas viven en `env-cross-checks.ts`.

| Variable | Tipo | Requerida | Default (código) | Notas |
|---|---|---|---|---|
| `API_DOCS_ENABLED` | string | No | — | Swagger/OpenAPI queda activo fuera de producción; en producción requiere activación explícita. |
| `API_JSON_BODY_LIMIT` | string | No | `2mb` | — |
| `API_PREFIX` | string | No | `api/v1` | — |
| `API_RATE_LIMIT_MAX` | number | No | `100` | — |
| `API_RATE_LIMIT_TTL_MS` | number | No | `60_000` | — |
| `APP_BUILT_AT` | string | No | — | — |
| `APP_COMMIT_SHA` | string | No | — | — |
| `APP_PORT` | number | No | `3005` | — |
| `APP_ROLE` | enum (`api, worker, all`) | No | `all` | Rol de ESTE proceso. Un mismo artefacto se despliega como API, como worker o como ambos:   api    → atiende HTTP; no arr |
| `APP_VERSION` | string | No | — | Identidad del artefacto desplegado, inyectada por el pipeline al construir la imagen. Sin ella, `/health` no puede decir |
| `AUTH_COOKIE_DOMAIN` | string | No | — | — |
| `AUTH_COOKIE_SAMESITE` | enum (`lax, strict, none`) | No | `lax` | — |
| `AUTH_COOKIE_SECURE` | string | No | — | — |
| `AUTH_LOCKOUT_MINUTES` | number | No | `15` | — |
| `AUTH_LOGIN_PIN_ENABLED` | string | No | `true` | Códigos de un solo uso (reset de contraseña y PIN de login de administradores). El PIN de super admin solo se exige cuan |
| `AUTH_MAX_FAILED_LOGIN_ATTEMPTS` | number | No | `5` | — |
| `AUTH_ONE_TIME_CODE_MAX_ATTEMPTS` | number | No | `5` | — |
| `AUTH_ONE_TIME_CODE_TTL_MINUTES` | number | No | `10` | — |
| `AUTH_REFRESH_TOKEN_EXPIRES_IN_DAYS` | number | No | `30` | — |
| `AWS_REGION` | string | No | — | — |
| `CORS_ORIGINS` | string | No | `http://localhost:3000,http://localhost:5273` | — |
| `DATABASE_CLEAN_ALLOW_PRODUCTION` | boolean | **Sí** | — | — |
| `DATABASE_CLEAN_BEFORE_SEED` | boolean | **Sí** | — | Limpieza previa a seeds. Por defecto está apagada. En producción exige doble confirmación para evitar borrar datos reale |
| `DATABASE_CLEAN_CONFIRM` | string | No | — | — |
| `DATABASE_SEED_ON_STARTUP` | boolean | **Sí** | — | Seeding idempotente AL ARRANCAR (opt-in). Si es true, el backend aplica los seeders pendientes del perfil (derivado de S |
| `DATABASE_SEED_ON_STARTUP_FAIL_FAST` | boolean | **Sí** | — | Si el seeding al arrancar falla y esto es true, el arranque ABORTA (exit). Por defecto false: se loguea el error y el ba |
| `DB_ADMIN_PASSWORD` | string | No | — | — |
| `DB_ADMIN_USER` | string | No | — | DB_ADMIN_USER/PASSWORD = identidad con CREATE ROLE usada SOLO por `yarn db:roles:bootstrap` para crear los roles del clu |
| `DB_APP_RO_PASSWORD` | string | No | — | — |
| `DB_APP_RW_PASSWORD` | string | No | — | Contraseñas que `yarn db:roles:bootstrap` asigna a cada rol. No tienen default a propósito: una contraseña "de repuesto" |
| `DB_HOST` | string | No | `localhost` | — |
| `DB_IDLE_IN_TRANSACTION_TIMEOUT_MS` | number | No | `60_000` | — |
| `DB_MIGRATION_PASSWORD` | string | No | — | — |
| `DB_MIGRATION_USER` | string | No | — | --- Separación de identidades PostgreSQL (docs/database/postgres-roles.md) --------------- DB_USER/DB_PASSWORD  = RUNTIM |
| `DB_MIGRATOR_PASSWORD` | string | No | — | — |
| `DB_NAME` | string | No | `atlas` | — |
| `DB_PASSWORD` | string | No | `<valor de dev — ver código>` | — |
| `DB_POOL_ACQUIRE_MS` | number | No | `30_000` | — |
| `DB_POOL_IDLE_MS` | number | No | `10_000` | — |
| `DB_POOL_MAX` | number | No | `20` | Pool de conexiones Sequelize. Sin estas vars, Sequelize aplica su default `max: 5`, que se queda corto frente a la concu |
| `DB_POOL_MIN` | number | No | `2` | — |
| `DB_PORT` | number | No | `5432` | — |
| `DB_READ_ENABLED` | boolean | **Sí** | — | Pool de LECTURA opcional (Fase 2/5 del plan de mejora del modelo de datos). La conexión write/default sigue siendo DB_HO |
| `DB_READ_HOST` | string | No | — | — |
| `DB_READ_NAME` | string | No | — | — |
| `DB_READ_PASSWORD` | string | No | — | — |
| `DB_READ_POOL_MAX` | number | No | `10` | — |
| `DB_READ_PORT` | number | No | — | — |
| `DB_READ_SCHEMA` | string | No | — | — |
| `DB_READ_SSL` | string | No | — | — |
| `DB_READ_USER` | string | No | — | — |
| `DB_SCHEMA` | string | No | `public` | — |
| `DB_SSL` | boolean | **Sí** | — | — |
| `DB_SSL_REJECT_UNAUTHORIZED` | boolean | No | `true` | — |
| `DB_STATEMENT_TIMEOUT_MS` | number | No | `60_000` | Techos del lado del SERVIDOR para una sesión de Postgres. `REQUEST_TIMEOUT_MS` corta el Observable del request, pero no  |
| `DB_USER` | string | No | `postgres` | — |
| `EXTERNAL_PROVIDERS_ALLOW_MOCK_IN_PRODUCTION` | boolean | **Sí** | — | — |
| `EXTERNAL_PROVIDERS_MOCK_BASE_URL` | string | No | — | Proveedores externos (KYC, buró, telco, banca, confianza digital). El modo EFECTIVO de cada uno sale de la base (`extern |
| `FCM_CLIENT_EMAIL` | string | No | — | — |
| `FCM_PRIVATE_KEY` | string | No | — | — |
| `FCM_PROJECT_ID` | string | No | — | — |
| `GMAIL_CLIENT_ID` | string | No | — | — |
| `GMAIL_CLIENT_SECRET` | string | No | — | — |
| `GMAIL_FROM_EMAIL` | string | No | — | — |
| `GMAIL_REFRESH_TOKEN` | string | No | — | — |
| `HEALTH_DB_PING_TIMEOUT_MS` | number | No | `2_000` | Techo del ping de Postgres del readiness probe. Sin él, `sequelize.authenticate()` queda a merced del `acquire` del pool |
| `INTERNAL_FRONTEND_ORIGIN` | string | No | `http://localhost:5273` | — |
| `JWT_ACCESS_TOKEN_EXPIRES_IN` | string | No | `1h` | — |
| `JWT_ACCESS_TOKEN_SECRET` | string | No | `<valor de dev — ver código>` | — |
| `JWT_AUDIENCE` | string | No | `atlas-api` | — |
| `JWT_ISSUER` | string | No | `atlas-backend` | Emisor y audiencia del token de acceso (hallazgo A-08 de docs/audit/auditoria-integral-2026-07-30.md). Acotan para QUÉ v |
| `KMS_KEY_ID` | string | No | — | Opcionales a propósito. Si AMBOS están presentes, `main.ts` ACTIVA `KmsKeyProvider` como proveedor de cifrado de envelop |
| `LOG_FORMAT` | enum (`json, pretty`) | No | — | Formato de la salida por CONSOLA (stdout). `json` emite una línea JSON por evento, con correlationId/traceId y la MISMA  |
| `LOG_SYNC_FAILURE_PAUSE_MS` | number | No | `60_000` | — |
| `LOG_SYNC_FAILURES_BEFORE_PAUSE` | number | No | `3` | — |
| `LOG_SYNC_FILE_PATH` | string | No | `Archivo.log` | — |
| `LOG_SYNC_IMPORT_EXISTING_ON_FIRST_BOOT` | boolean | **Sí** | — | — |
| `LOG_SYNC_INTERVAL_MS` | number | No | `5_000` | — |
| `LOG_SYNC_MAX_CHUNK_BYTES` | number | No | `1_000_000` | — |
| `LOG_SYNC_MONGO_SERVER_SELECTION_TIMEOUT_MS` | number | No | `5_000` | — |
| `MAILSENDER_ADMIN_PASSWORD` | string | No | — | — |
| `MAILSENDER_ADMIN_USERNAME` | string | No | — | — |
| `MAILSENDER_API_PREFIX` | string | No | `/api/v1` | — |
| `MAILSENDER_BASE_URL` | string | No | — | Integración con MailSender (microservicio de mensajería transaccional, proyecto hermano). MAILSENDER_BASE_URL vacío = in |
| `MAILSENDER_EXTERNAL_API_KEY` | string | No | — | — |
| `MALWARE_SCAN_FAIL_CLOSED` | boolean | No | `true` | — |
| `MALWARE_SCAN_HOST` | string | No | — | Escaneo antimalware de la evidencia (clamd por TCP). Vacío = apagado (solo desarrollo). |
| `MALWARE_SCAN_PORT` | number | No | — | — |
| `MALWARE_SCAN_TIMEOUT_MS` | number | No | `20_000` | — |
| `META_WHATSAPP_DEFAULT_TEMPLATE_LANGUAGE` | string | No | `es` | — |
| `META_WHATSAPP_DEFAULT_TEMPLATE_NAME` | string | No | — | — |
| `META_WHATSAPP_PHONE_NUMBER_ID` | string | No | — | — |
| `META_WHATSAPP_TOKEN` | string | No | — | — |
| `MONGO_DB_URL_CONNECTION` | string | No | — | — |
| `MONGO_LOGS_COLLECTION` | string | No | `archivo_log_updates` | — |
| `MONGO_LOGS_DB_NAME` | string | No | `atlas_logs` | — |
| `NODE_ENV` | enum (`development, test, production`) | No | `development` | — |
| `NOTIFICATION_DEFAULT_LOCALE` | string | No | `es-BO` | — |
| `NOTIFICATION_EMAIL_PROVIDER` | enum (`disabled, resend, sendgrid, gmail_api, webhook`) | No | `disabled` | — |
| `NOTIFICATION_EMAIL_WEBHOOK_URL` | string | No | — | — |
| `NOTIFICATION_PHONE_PROVIDER` | enum (`disabled, webhook`) | No | `disabled` | — |
| `NOTIFICATION_PHONE_WEBHOOK_URL` | string | No | — | — |
| `NOTIFICATION_PROVIDER_HTTP_RETRIES` | number | No | `1` | — |
| `NOTIFICATION_PROVIDER_HTTP_RETRY_BASE_DELAY_MS` | number | No | `250` | — |
| `NOTIFICATION_PROVIDER_HTTP_TIMEOUT_MS` | number | No | `15_000` | — |
| `NOTIFICATION_PUSH_INCLUDE_VISIBLE_NOTIFICATION` | boolean | **Sí** | — | — |
| `NOTIFICATION_PUSH_PROVIDER` | enum (`disabled, fcm, webhook`) | No | `disabled` | — |
| `NOTIFICATION_PUSH_WEBHOOK_URL` | string | No | — | — |
| `NOTIFICATION_SMS_PROVIDER` | enum (`disabled, twilio, webhook`) | No | `disabled` | — |
| `NOTIFICATION_SMS_WEBHOOK_URL` | string | No | — | — |
| `NOTIFICATION_TOKEN_ENCRYPTION_KEY` | string | No | `<valor de dev — ver código>` | — |
| `NOTIFICATION_WEBHOOK_URL` | string | No | — | — |
| `NOTIFICATION_WHATSAPP_PROVIDER` | enum (`disabled, meta_cloud, twilio, webhook`) | No | `disabled` | — |
| `NOTIFICATION_WHATSAPP_WEBHOOK_URL` | string | No | — | — |
| `NOTIFICATIONS_DELIVERY_MODE` | enum (`inline, deferred`) | No | `inline` | Dónde se ENTREGA un broadcast de notificaciones:   inline   → en el mismo proceso que atendió el POST, fuera del request |
| `REDIS_URL` | string | No | — | Redis respalda el rate limiting distribuido cuando hay más de una instancia. |
| `REQUEST_TIMEOUT_MS` | number | No | `30_000` | — |
| `RESEND_API_KEY` | string | No | — | — |
| `RESEND_FROM_EMAIL` | string | No | — | — |
| `RUNTIME_JOBS_ALLOW_WITHOUT_LOCK` | boolean | **Sí** | — | — |
| `RUNTIME_JOBS_BATCH_LIMIT` | number | No | `100` | — |
| `RUNTIME_JOBS_DATA_QUALITY_INTERVAL_MS` | number | No | `3_600_000` | — |
| `RUNTIME_JOBS_EVENTS_INTERVAL_MS` | number | No | `30_000` | — |
| `RUNTIME_JOBS_IDEMPOTENCY_PURGE_INTERVAL_MS` | number | No | `86_400_000` | — |
| `RUNTIME_JOBS_IDEMPOTENCY_RETENTION_DAYS` | number | No | `30` | — |
| `RUNTIME_JOBS_LEADER_LOCK_TTL_MS` | number | No | `900_000` | — |
| `RUNTIME_JOBS_NOTIFICATION_DELIVERY_INTERVAL_MS` | number | No | `10_000` | Entrega de los mensajes recién creados por un broadcast, cuando la entrega NO corre dentro del proceso que atendió el re |
| `RUNTIME_JOBS_NOTIFICATION_RETRY_INTERVAL_MS` | number | No | `300_000` | Barrido de mensajes de notificación que quedaron a medio entregar tras un reinicio, y purga de claves de idempotencia ya |
| `RUNTIME_JOBS_NOTIFICATION_STUCK_MINUTES` | number | No | `15` | — |
| `RUNTIME_JOBS_OUTBOX_INTERVAL_MS` | number | No | `30_000` | — |
| `RUNTIME_JOBS_RETENTION_INTERVAL_MS` | number | No | `86_400_000` | — |
| `RUNTIME_JOBS_SCHEDULER_ENABLED` | boolean | **Sí** | — | Planificador (`RuntimeJobsSchedulerService`). Opt-in: un proceso que arranca en un test, un script o una consola de mant |
| `RUNTIME_JOBS_SESSION_MAX_IDLE_MINUTES` | number | No | `120` | — |
| `RUNTIME_JOBS_SESSIONS_INTERVAL_MS` | number | No | `300_000` | — |
| `RUNTIME_JOBS_START_JITTER_MS` | number | No | `15_000` | Dispersión aleatoria del PRIMER tick de cada job. Con N réplicas arrancando a la vez tras un despliegue, todas piden el  |
| `RUNTIME_JOBS_STUCK_EVENT_MINUTES` | number | No | `15` | — |
| `RUNTIME_JOBS_STUCK_EVENTS_INTERVAL_MS` | number | No | `300_000` | Recuperación de eventos VARADOS. `claimPending` marca el evento como `processing` y le pone `locked_by`; si el proceso m |
| `RUNTIME_JOBS_TICK_TIMEOUT_MS` | number | No | `300_000` | Techo de duración de UNA tanda del planificador (todos los tenants de un job). Sin él, un job colgado en una consulta qu |
| `SEED_PROFILE` | enum (`production, development, demo, test`) | No | — | Perfil de seeds a ejecutar (production \| development \| demo \| test). Si no se define, el runner lo deriva de NODE_ENV |
| `SENDGRID_API_KEY` | string | No | — | — |
| `SENDGRID_FROM_EMAIL` | string | No | — | — |
| `SHUTDOWN_DRAIN_MS` | number | No | `0` | Ciclo de vida del proceso (hallazgo A-07 de docs/audit/auditoria-integral-2026-07-30.md). SHUTDOWN_DRAIN_MS: al recibir  |
| `STORAGE_S3_ACCESS_KEY_ID` | string | No | — | — |
| `STORAGE_S3_BUCKET` | string | No | — | — |
| `STORAGE_S3_ENDPOINT` | string | No | — | Almacenamiento de evidencia (compatible con S3). Vacío = apagado: los endpoints responden 503 en vez de aceptar un `stor |
| `STORAGE_S3_FORCE_PATH_STYLE` | boolean | No | `true` | MinIO y compatibles requieren el bucket en la ruta; AWS acepta ambos estilos. |
| `STORAGE_S3_REGION` | string | No | `us-east-1` | — |
| `STORAGE_S3_SECRET_ACCESS_KEY` | string | No | — | — |
| `STORAGE_UPLOAD_URL_TTL_SECONDS` | number | No | `300` | — |
| `SYSTEM_HEALTH_MONITOR_ENABLED` | string | No | `true` | Monitor de salud de herramientas críticas (systems-ops): chequea periódicamente SystemsHealthService.getToolsHealth() y  |
| `SYSTEM_HEALTH_MONITOR_INTERVAL_MS` | number | No | `60_000` | — |
| `SYSTEM_TEST_ALLOWED_HOSTS_LOCAL` | string | No | `localhost,127.0.0.1,::1,host.docker.internal` | — |
| `SYSTEM_TEST_ALLOWED_HOSTS_PRODUCTION_READONLY` | string | No | `` | — |
| `SYSTEM_TEST_ALLOWED_HOSTS_STAGING` | string | No | `` | — |
| `TWILIO_ACCOUNT_SID` | string | No | — | — |
| `TWILIO_AUTH_TOKEN` | string | No | — | — |
| `TWILIO_SMS_FROM` | string | No | — | — |
| `TWILIO_WHATSAPP_FROM` | string | No | — | — |
| `WORKER_PROBE_PORT` | number | No | `3006` | Puerto de la sonda del worker (`/health/liveness`, `/health/readiness`, `/metrics`). Es un puerto distinto del de la API |

## Variables en `.env.example` sin schema Zod

`RIESGO` — 49 nombres aparecen en `.env.example` pero no en el schema Zod. O son de herramientas externas (Docker, scripts), o son documentación obsoleta: al no estar en el schema, **el arranque no los valida ni los expone en `env`**.

`INTERNAL_SMOKE_PASSWORD`, `INTERNAL_SMOKE_QA_PASSWORD`, `SEGIP_MODE`, `SEGIP_MOCK_BASE_URL`, `SEGIP_BASE_URL`, `SEGIP_CLIENT_ID`, `SEGIP_CLIENT_SECRET`, `INFOCENTER_MODE`, `INFOCENTER_MOCK_BASE_URL`, `INFOCENTER_BASE_URL`, `INFOCENTER_CLIENT_ID`, `INFOCENTER_CLIENT_SECRET`, `INFOCENTER_ALLOW_AUTOMATIC_QUERIES`, `INFOCENTER_DEFAULT_BLOCK_BY_COST`, `QR_GENERIC_MODE`, `QR_GENERIC_MOCK_BASE_URL`, `BANKING_GENERIC_MODE`, `BANKING_GENERIC_MOCK_BASE_URL`, `TELCO_GENERIC_MODE`, `TELCO_GENERIC_MOCK_BASE_URL`, `FACEBOOK_META_MODE`, `FACEBOOK_META_MOCK_BASE_URL`, `WHATSAPP_GENERIC_MODE`, `WHATSAPP_GENERIC_MOCK_BASE_URL`, `DIGITAL_TRUST_GENERIC_MODE`, `DIGITAL_TRUST_GENERIC_MOCK_BASE_URL`, `MOCK_PROVIDERS_PORT`, `MOCK_PROVIDERS_DEFAULT_LATENCY_MS`, `MOCK_PROVIDERS_SCENARIO`, `EXTERNAL_PROVIDER_CACHE_TTL_SECONDS`, `EXTERNAL_FEATURE_MAX_AGE_HOURS`, `EXTERNAL_PROVIDER_CIRCUIT_BREAKER_ENABLED`, `EXTERNAL_PROVIDER_CIRCUIT_BREAKER_FAILURE_THRESHOLD`, `EXTERNAL_PROVIDER_CIRCUIT_BREAKER_WINDOW_MS`, `EXTERNAL_PROVIDER_PROD_GATE_SANITIZATION_SAMPLE`, `EXTERNAL_PROVIDER_SLA_FAILURE_WARN_PERCENT`, `EXTERNAL_PROVIDER_SLA_P95_LATENCY_WARN_MS`, `OTEL_ENABLED`, `OTEL_EXPORTER_OTLP_ENDPOINT`, `OTEL_TRACES_SAMPLER`, `OTEL_TRACES_SAMPLER_ARG`, `QR_GENERIC_BASE_URL`, `BANKING_GENERIC_BASE_URL`, `TELCO_GENERIC_BASE_URL`, `DIGITAL_TRUST_GENERIC_BASE_URL`, `META_FACEBOOK_APP_ID`, `META_FACEBOOK_APP_SECRET`, `META_FACEBOOK_REDIRECT_URI`, `WHATSAPP_PROVIDER`

## Relaciones

- Configuración por entorno: [[10-operations/configuration]] · [[10-operations/environments]]
- Gestión de secretos: [[08-security/secrets-management]]
