# Variables de entorno — ATLAS Backend

Este documento explica los grupos de configuración que cambian comportamiento. La lista exhaustiva
y copiable vive en [`.env.example`](../../.env.example); el contrato de tipos, defaults y validaciones
vive en [`src/config/env.schema.ts`](../../src/config/env.schema.ts). Si difieren, el esquema es la
fuente ejecutable y `.env.example` debe corregirse en el mismo cambio.

> Seguridad TLS: cuando `DB_SSL=true`, `DB_SSL_REJECT_UNAUTHORIZED` vale `true` por defecto y no
> puede desactivarse en produccion. Instala la CA de PostgreSQL en el entorno en lugar de omitir
> la validacion del certificado.

## Regla de arquitectura

La bandeja interna (`in_app`) es propia de ATLAS y no usa proveedor externo. Los canales externos se activan por configuración:

```txt
outbox_events
→ process-events
→ notification_messages
→ channel adapter
→ provider configurado
→ notification_deliveries
```

El core no debe llamar directamente a Gmail, Firebase, Twilio, Meta ni ningún proveedor desde servicios de negocio.

## Base mínima local

```env
NODE_ENV=development
APP_PORT=3005
API_PREFIX=api/v1
API_JSON_BODY_LIMIT=2mb
API_DOCS_ENABLED=true
CORS_ORIGINS=http://localhost:3000,http://localhost:5273
INTERNAL_FRONTEND_ORIGIN=http://localhost:5273
DB_HOST=localhost
DB_PORT=5432
DB_NAME=atlas
DB_USER=postgres
DB_PASSWORD=postgres
DB_SCHEMA=public
DB_SSL=false
JWT_ACCESS_TOKEN_SECRET=change-this-secret-with-at-least-32-characters
JWT_ACCESS_TOKEN_EXPIRES_IN=1h
API_RATE_LIMIT_TTL_MS=60000
API_RATE_LIMIT_MAX=100
```

`API_DOCS_ENABLED` se activa por defecto fuera de producción. En producción debe habilitarse de
forma explícita y quedar detrás de controles de red/autenticación operativa.

## Autenticación, cookies y códigos de un solo uso

```env
AUTH_REFRESH_TOKEN_EXPIRES_IN_DAYS=30
AUTH_MAX_FAILED_LOGIN_ATTEMPTS=5
AUTH_LOCKOUT_MINUTES=15
AUTH_LOGIN_PIN_ENABLED=true
AUTH_ONE_TIME_CODE_TTL_MINUTES=10
AUTH_ONE_TIME_CODE_MAX_ATTEMPTS=5
AUTH_COOKIE_SAMESITE=lax
AUTH_COOKIE_DOMAIN=
AUTH_COOKIE_SECURE=false
```

- Los códigos de login, reset y verificación se guardan hasheados, expiran y se consumen una vez.
- `AUTH_LOGIN_PIN_ENABLED` exige PIN interno solo cuando MailSender está disponible para entregarlo.
- `AUTH_COOKIE_SECURE` se deriva como `true` en producción si no se fija.
- `SameSite=none` solo corresponde a portal/API en dominios distintos y exige `Secure=true`.

## MailSender transaccional

```env
MAILSENDER_BASE_URL=
MAILSENDER_API_PREFIX=/api/v1
MAILSENDER_EXTERNAL_API_KEY=
MAILSENDER_ADMIN_USERNAME=
MAILSENDER_ADMIN_PASSWORD=
```

URL vacía desactiva la integración. Al configurarla se requieren la API key de envío y credenciales
administrativas para auto-provisionar plantillas. Los secretos pertenecen al secret manager, nunca a
archivos versionados.

## Cifrado KMS y almacenamiento documental

```env
KMS_KEY_ID=
AWS_REGION=
STORAGE_S3_ENDPOINT=
STORAGE_S3_BUCKET=
STORAGE_S3_REGION=us-east-1
STORAGE_S3_ACCESS_KEY_ID=
STORAGE_S3_SECRET_ACCESS_KEY=
STORAGE_S3_FORCE_PATH_STYLE=true
STORAGE_UPLOAD_URL_TTL_SECONDS=300
```

Si `KMS_KEY_ID` y `AWS_REGION` están presentes, el runtime usa AWS KMS para nuevas escrituras de PII;
la imagen incluye `@aws-sdk/client-kms` y las credenciales deben llegar por IAM role/workload identity.
Sin KMS, desarrollo usa el proveedor local; producción emite una advertencia de hardening.

El almacenamiento acepta S3, MinIO y compatibles. Si endpoint/bucket/credenciales no están completos,
los endpoints documentales responden 503: nunca aceptan un `storageKey` que el servidor no pueda
verificar. La URL prefirmada limita prefijo y vigencia.

## Seeding idempotente al arrancar (opt-in)

```env
DATABASE_SEED_ON_STARTUP=false
DATABASE_SEED_ON_STARTUP_FAIL_FAST=false
```

Con `DATABASE_SEED_ON_STARTUP=true`, el backend aplica al iniciar (`onApplicationBootstrap`) los
seeders **pendientes** del perfil — derivado de `SEED_PROFILE`/`NODE_ENV`
(`production→production`, `test→test`, resto→`development`) — de forma **idempotente**: Umzug solo
corre los seeders no ejecutados y los propios seeders son upsert-safe (`ON CONFLICT DO NOTHING` /
`WHERE NOT EXISTS`). En `development` esto siembra el admin `pablo@atlas.internal` sin correr
`yarn db:seed:dev` a mano.

Seguridad: **nunca** corre seeders de dev/demo en producción (el perfil `production` solo incluye el
stage `production`, validado por `assertProfileAllowedForEnv`). Usa la identidad de migración
(`DB_MIGRATION_USER`, cae a `DB_USER` en local), así que en un despliegue con roles separados esa
credencial debe estar disponible.

Modo de fallo: por defecto un fallo de seed se **loguea y el backend arranca igual** (un seed roto no
debería tumbar la API). Con `DATABASE_SEED_ON_STARTUP_FAIL_FAST=true` el arranque **aborta** ante un
fallo de seed.

> Migraciones (DDL) **no** corren al arrancar: requieren la identidad `atlas_migrator` y son un paso
> deliberado (`yarn db:migration:up`). El seeding al arrancar solo inserta datos.

## Pool de conexiones y timeouts (hardening 2026-07-21)

Sin estas variables, Sequelize usa `max: 5`, que se queda corto frente a la concurrencia real (p. ej.
el fan-out de notificaciones asume ~25). Todas tienen default; dimensiona `DB_POOL_MAX` de modo que
`(instancias × DB_POOL_MAX)` no supere el `CONNECTION LIMIT` de `atlas_app_rw` (50).

```env
DB_POOL_MAX=20
DB_POOL_MIN=2
DB_POOL_ACQUIRE_MS=30000
DB_POOL_IDLE_MS=10000
DB_READ_POOL_MAX=10
```

Los timeouts de statement/transacción se fijan a nivel de rol PostgreSQL (no por env), ver
`docs/database/postgres-roles.md`.

## OpenTelemetry (trazas) — opt-in

Si `OTEL_ENABLED` no está en `true`, el tracing es no-op (cero impacto). En producción **no** muestrees
al 100% (default del SDK): usa un ratio parent-based.

```env
OTEL_ENABLED=false
OTEL_EXPORTER_OTLP_ENDPOINT=
OTEL_TRACES_SAMPLER=parentbased_traceidratio
OTEL_TRACES_SAMPLER_ARG=0.1
```

Cuando el tracing está activo, el `trace_id` del span en curso se incluye en cada línea de log
(`Archivo.log` es JSON estructurado con `correlationId` + `traceId`).

## Monitor de herramientas críticas

```env
SYSTEM_HEALTH_MONITOR_ENABLED=true
SYSTEM_HEALTH_MONITOR_INTERVAL_MS=60000
```

El monitor consulta el catálogo de herramientas críticas y notifica a usuarios internos cuando una
dependencia cae o se recupera. Puede desactivarse en tests efímeros; no sustituye liveness/readiness.

## Proveedores de datos externos

Los modos y credenciales `SEGIP_*`, `INFOCENTER_*`, `*_GENERIC_*` y políticas
`EXTERNAL_PROVIDER_*` se enumeran en `.env.example` y se explican por flujo en
[`docs/external-providers/README.md`](../external-providers/README.md).

Producción **no puede** usar `mock_local` ni `mock_server`: desde el hallazgo A-02 de
[la auditoría integral 2026-07-30](../audit/auditoria-integral-2026-07-30.md) eso ya no es una regla
escrita, es un portón. Antes era una regla y se incumplía sola: los nueve proveedores se siembran con
`default_mode = 'mock_local'` y `toMode()` también caía ahí, así que un despliegue que no fijara el
modo explícitamente verificaba identidades y calculaba riesgo sobre payloads inventados por el propio
adaptador, persistidos como observaciones y features del cliente.

```env
# Escape hatch. Con false (default), un proveedor en modo simulado responde PROVIDER_UNAVAILABLE en
# producción en vez de devolver evidencia inventada. Con true exige EXTERNAL_PROVIDERS_MOCK_BASE_URL.
EXTERNAL_PROVIDERS_ALLOW_MOCK_IN_PRODUCTION=false
EXTERNAL_PROVIDERS_MOCK_BASE_URL=
```

Un proveedor sin integración real se deja en `${CODE}_MODE=disabled`, no en modo simulado: `disabled`
responde un error explícito, simulado respondía un dato falso. Al arrancar, el log lista cada
proveedor bloqueado y `GET /external-data/providers/readiness` los reporta con el blocker
`*_MOCK_MODE_IN_PRODUCTION`.

## Trabajos de fondo programados

Los cinco jobs de `POST /operations/jobs/*` **también corren solos** desde el hallazgo A-03. Es
opt-in: un proceso que arranca en un test o en una consola de mantenimiento no debe empezar a mutar
datos por su cuenta. En producción es obligatorio — sin él, el outbox no se despacha, las sesiones
caducadas no expiran y las políticas de retención de datos personales no se aplican nunca.

```env
RUNTIME_JOBS_SCHEDULER_ENABLED=true
# La elección de líder usa REDIS_URL: con N instancias, solo una ejecuta cada tanda. Sin Redis, en
# producción el planificador NO arranca salvo que se asuma el riesgo con esta bandera.
RUNTIME_JOBS_ALLOW_WITHOUT_LOCK=false
RUNTIME_JOBS_LEADER_LOCK_TTL_MS=900000
RUNTIME_JOBS_BATCH_LIMIT=100
RUNTIME_JOBS_OUTBOX_INTERVAL_MS=30000
RUNTIME_JOBS_EVENTS_INTERVAL_MS=30000
RUNTIME_JOBS_SESSIONS_INTERVAL_MS=300000
RUNTIME_JOBS_SESSION_MAX_IDLE_MINUTES=120
RUNTIME_JOBS_RETENTION_INTERVAL_MS=86400000
RUNTIME_JOBS_DATA_QUALITY_INTERVAL_MS=3600000
# Barrido de mensajes que quedaron en pending/sending tras un reinicio a mitad de broadcast, y purga
# de claves de idempotencia ya resueltas. Ambas colas crecían sin que nada las recogiera.
RUNTIME_JOBS_NOTIFICATION_RETRY_INTERVAL_MS=300000
RUNTIME_JOBS_NOTIFICATION_STUCK_MINUTES=15
RUNTIME_JOBS_IDEMPOTENCY_PURGE_INTERVAL_MS=86400000
RUNTIME_JOBS_IDEMPOTENCY_RETENTION_DAYS=30
```

`RUNTIME_JOBS_IDEMPOTENCY_RETENTION_DAYS` no baja de 1 a propósito: la ventana de reintento de un
cliente es de minutos u horas, pero borrar una clave que todavía podría replayearse convertiría un
reintento en una segunda ejecución del comando. Las claves en `processing` no se tocan nunca.

## Identidad del build y ciclo de vida del proceso

```env
# Las inyecta el pipeline al construir la imagen (--build-arg). GET /health las reporta: son la
# única forma fiable de saber qué build está corriendo (npm_package_version no existe al arrancar
# con `node dist/src/main.js`).
APP_VERSION=
APP_COMMIT_SHA=
APP_BUILT_AT=

# json = una línea JSON por evento en stdout, con correlationId/traceId y PII REDACTADA.
# pretty = formato humano de ConsoleLogger, SIN redactar. Sin valor: json en producción, pretty en el
# resto. En un contenedor, stdout es el pipeline de logs real: `pretty` en producción publica PII.
LOG_FORMAT=json

# Al recibir SIGTERM, readiness pasa a 503 y se espera esto antes de cerrar, para que el balanceador
# retire la instancia sin cortar peticiones. Debe ser MAYOR que el intervalo del readiness probe del
# orquestador, y `terminationGracePeriodSeconds` mayor que este valor. 0 lo desactiva (dev/tests).
SHUTDOWN_DRAIN_MS=15000

# Techo de duración de cualquier petición. Menor que el timeout del proxy, para que quien corte sea
# el backend (con su 503 medido) y no el proxy. Exime /metrics y los probes de salud. 0 lo desactiva.
REQUEST_TIMEOUT_MS=30000
```

## Emisor y audiencia del JWT

```env
JWT_ISSUER=atlas-backend
JWT_AUDIENCE=atlas-api
```

Acotan para qué vale un token firmado con `JWT_ACCESS_TOKEN_SECRET`. Sin ellos, cualquier token
firmado con ese secreto para otro propósito —por ejemplo la sonda de `systems-health.service.ts`— era
un token de sesión en potencia (hallazgo A-08). **Cambiar cualquiera de los dos invalida los tokens
de acceso vigentes**; los refresh tokens son opacos y no se ven afectados, así que los clientes
renuevan solos.

## Sincronizacion remota de Archivo.log

El backend puede enviar cambios de `Archivo.log` a MongoDB cada 5 segundos. Cada arranque genera un
`idArranque` nuevo (`bootId`) y registra documentos append-only en la coleccion configurada:
un documento `startup`, documentos `append` con solo los bytes nuevos y, si el archivo se trunca o
rota, un documento `rotation`.

```env
MONGO_DB_URL_CONNECTION=mongodb+srv://<usuario>:<password>@<cluster-host>/?appName=AtlasBackend
MONGO_LOGS_DB_NAME=atlas_logs
MONGO_LOGS_COLLECTION=archivo_log_updates
LOG_SYNC_FILE_PATH=Archivo.log
LOG_SYNC_INTERVAL_MS=5000
LOG_SYNC_MAX_CHUNK_BYTES=1000000
LOG_SYNC_IMPORT_EXISTING_ON_FIRST_BOOT=false
LOG_SYNC_MONGO_SERVER_SELECTION_TIMEOUT_MS=5000
LOG_SYNC_FAILURES_BEFORE_PAUSE=3
LOG_SYNC_FAILURE_PAUSE_MS=60000
```

Si `MONGO_DB_URL_CONNECTION` esta vacio, la sincronizacion queda desactivada. En el primer arranque
sin historico remoto, `LOG_SYNC_IMPORT_EXISTING_ON_FIRST_BOOT=false` evita duplicar un `Archivo.log`
ya existente y empieza desde el final del archivo; los siguientes updates continuan desde el ultimo
`offsetTo` guardado en Mongo.

Si MongoDB rechaza TLS, credenciales o red, el worker no debe inundar logs: tras
`LOG_SYNC_FAILURES_BEFORE_PAUSE` fallos consecutivos pausa nuevos intentos por
`LOG_SYNC_FAILURE_PAUSE_MS` y vuelve a intentar despues. Para MongoDB Atlas, un error como
`tlsv1 alert internal error` suele indicar URI/cluster SRV incorrecto, credenciales invalidas,
parametros TLS incompatibles o IP del backend fuera del access list del cluster.

Esa misma coleccion (`MONGO_LOGS_DB_NAME`/`MONGO_LOGS_COLLECTION`) ahora se puede leer por HTTP via
`GET /api/v1/systems/logs/mongo` (`MongoLogsQueryService`, `src/modules/log-sync/`), con su propio
`MongoClient` independiente del que escribe. Si `MONGO_DB_URL_CONNECTION` no esta configurada, ese
endpoint responde `503 MONGO_LOGS_NOT_CONFIGURED` en vez de fallar la sincronizacion (que ya de por
si queda desactivada en ese caso).

## Matriz de proveedores soportados

| Canal      | Provider env                     | Valores soportados                                       | Credenciales requeridas |
| ---------- | -------------------------------- | -------------------------------------------------------- | ----------------------- |
| `in_app`   | no aplica                        | backend ATLAS                                            | ninguna                 |
| `email`    | `NOTIFICATION_EMAIL_PROVIDER`    | `disabled`, `resend`, `sendgrid`, `gmail_api`, `webhook` | según proveedor         |
| `push`     | `NOTIFICATION_PUSH_PROVIDER`     | `disabled`, `fcm`, `webhook`                             | según proveedor         |
| `sms`      | `NOTIFICATION_SMS_PROVIDER`      | `disabled`, `twilio`, `webhook`                          | según proveedor         |
| `whatsapp` | `NOTIFICATION_WHATSAPP_PROVIDER` | `disabled`, `meta_cloud`, `twilio`, `webhook`            | según proveedor         |
| `phone`    | `NOTIFICATION_PHONE_PROVIDER`    | `disabled`, `webhook`                                    | webhook                 |

`disabled` no es mock: significa que el canal queda apagado. Si una regla intenta enviar por ese canal, se registra un delivery fallido con error de configuración.

## Configuración común de notificaciones

```env
NOTIFICATION_DEFAULT_LOCALE=es-BO
NOTIFICATION_TOKEN_ENCRYPTION_KEY=change-this-32-plus-character-key-for-device-tokens
NOTIFICATION_PROVIDER_HTTP_TIMEOUT_MS=15000
NOTIFICATION_PROVIDER_HTTP_RETRIES=1
NOTIFICATION_PROVIDER_HTTP_RETRY_BASE_DELAY_MS=250
NOTIFICATION_PUSH_INCLUDE_VISIBLE_NOTIFICATION=false
```

`NOTIFICATION_TOKEN_ENCRYPTION_KEY` debe ser distinto de `JWT_ACCESS_TOKEN_SECRET` en producción. Sirve para cifrar `device_tokens.token_encrypted` y `notification_messages.delivery_targets_json`.

## Webhooks

Puedes usar un webhook genérico o uno por canal.

```env
NOTIFICATION_WEBHOOK_URL=
NOTIFICATION_EMAIL_WEBHOOK_URL=
NOTIFICATION_PUSH_WEBHOOK_URL=
NOTIFICATION_SMS_WEBHOOK_URL=
NOTIFICATION_WHATSAPP_WEBHOOK_URL=
NOTIFICATION_PHONE_WEBHOOK_URL=
```

Regla de resolución:

```txt
URL específica del canal
→ si no existe, NOTIFICATION_WEBHOOK_URL
→ si tampoco existe, WEBHOOK_URL_MISSING
```

Esto permite probar todos los canales a la vez sin acoplar el core a un proveedor real.

## Email

### Resend

```env
NOTIFICATION_EMAIL_PROVIDER=resend
RESEND_API_KEY=...
RESEND_FROM_EMAIL=no-reply@tu-dominio.com
```

### SendGrid

```env
NOTIFICATION_EMAIL_PROVIDER=sendgrid
SENDGRID_API_KEY=...
SENDGRID_FROM_EMAIL=no-reply@tu-dominio.com
```

### Gmail API

```env
NOTIFICATION_EMAIL_PROVIDER=gmail_api
GMAIL_CLIENT_ID=...
GMAIL_CLIENT_SECRET=...
GMAIL_REFRESH_TOKEN=...
GMAIL_FROM_EMAIL=...
```

Gmail API sirve para pruebas o bajo volumen. Para email transaccional de producción conviene usar Resend, SendGrid o implementar un adapter de SES.

### Webhook

```env
NOTIFICATION_EMAIL_PROVIDER=webhook
NOTIFICATION_EMAIL_WEBHOOK_URL=https://example.com/email-webhook
```

## Push — Firebase Cloud Messaging

```env
NOTIFICATION_PUSH_PROVIDER=fcm
FCM_PROJECT_ID=...
FCM_CLIENT_EMAIL=...
FCM_PRIVATE_KEY=-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n
```

El token FCM real debe guardarse cifrado. El hash sirve para deduplicación, pero no permite enviar push. Por privacidad, `NOTIFICATION_PUSH_INCLUDE_VISIBLE_NOTIFICATION=false` envía data-only push con `notificationMessageId`; si necesitas que el sistema operativo muestre título/cuerpo, cambia explícitamente a `true` y evita información sensible.

## SMS — Twilio

```env
NOTIFICATION_SMS_PROVIDER=twilio
TWILIO_ACCOUNT_SID=...
TWILIO_AUTH_TOKEN=...
TWILIO_SMS_FROM=+10000000000
```

## WhatsApp

### Meta WhatsApp Cloud API

```env
NOTIFICATION_WHATSAPP_PROVIDER=meta_cloud
META_WHATSAPP_TOKEN=...
META_WHATSAPP_PHONE_NUMBER_ID=...
META_WHATSAPP_DEFAULT_TEMPLATE_NAME=
META_WHATSAPP_DEFAULT_TEMPLATE_LANGUAGE=es
```

La implementación soporta texto simple y template fallback. Para mensajes iniciados por la empresa en producción, normalmente se deben mapear `notification_templates` internos contra templates aprobados por WhatsApp. Puedes enviar template mediante `payload.whatsappTemplateName`, `payload.whatsappTemplateLanguage` y `payload.whatsappTemplateParameters`, o usar `META_WHATSAPP_DEFAULT_TEMPLATE_NAME` como fallback controlado.

### Twilio WhatsApp

```env
NOTIFICATION_WHATSAPP_PROVIDER=twilio
TWILIO_ACCOUNT_SID=...
TWILIO_AUTH_TOKEN=...
TWILIO_WHATSAPP_FROM=whatsapp:+10000000000
```

## Phone/calls

El canal `phone` queda soportado mediante webhook:

```env
NOTIFICATION_PHONE_PROVIDER=webhook
NOTIFICATION_PHONE_WEBHOOK_URL=https://example.com/phone-call-webhook
```

Para proveedores reales de llamadas, primero se recomienda exponerlos detrás de un webhook interno. Luego se puede crear un adapter de primer nivel si el volumen lo justifica.

## Configuraciones recomendadas

### Desarrollo seguro

```env
NOTIFICATION_EMAIL_PROVIDER=disabled
NOTIFICATION_PUSH_PROVIDER=disabled
NOTIFICATION_SMS_PROVIDER=disabled
NOTIFICATION_WHATSAPP_PROVIDER=disabled
NOTIFICATION_PHONE_PROVIDER=disabled
```

### Staging con webhooks por canal

```env
NOTIFICATION_EMAIL_PROVIDER=webhook
NOTIFICATION_PUSH_PROVIDER=webhook
NOTIFICATION_SMS_PROVIDER=webhook
NOTIFICATION_WHATSAPP_PROVIDER=webhook
NOTIFICATION_PHONE_PROVIDER=webhook
NOTIFICATION_EMAIL_WEBHOOK_URL=https://staging-hooks.atlas.test/email
NOTIFICATION_PUSH_WEBHOOK_URL=https://staging-hooks.atlas.test/push
NOTIFICATION_SMS_WEBHOOK_URL=https://staging-hooks.atlas.test/sms
NOTIFICATION_WHATSAPP_WEBHOOK_URL=https://staging-hooks.atlas.test/whatsapp
NOTIFICATION_PHONE_WEBHOOK_URL=https://staging-hooks.atlas.test/phone
```

### Producción inicial sugerida

```env
NOTIFICATION_EMAIL_PROVIDER=resend
NOTIFICATION_PUSH_PROVIDER=fcm
NOTIFICATION_SMS_PROVIDER=disabled
NOTIFICATION_WHATSAPP_PROVIDER=disabled
NOTIFICATION_PHONE_PROVIDER=disabled
```

Activa SMS/WhatsApp cuando ya tengas datos de contacto validados, consentimiento, templates aprobados y costos controlados.

## Reglas de hardening vigentes

- Validación fail-fast de credenciales cuando un provider está activo.
- Validación fail-fast de webhooks cuando un canal usa `webhook`.
- `NOTIFICATION_TOKEN_ENCRYPTION_KEY` obligatorio y separado del JWT en producción.
- `NOTIFICATION_PUSH_INCLUDE_VISIBLE_NOTIFICATION=false` por privacidad.
- Meta WhatsApp Cloud soporta template fallback mediante `whatsappTemplateName` o `META_WHATSAPP_DEFAULT_TEMPLATE_NAME`.
