# Variables de entorno — ATLAS Backend

Este documento define las variables de entorno esperadas para ejecutar ATLAS y activar proveedores de notificaciones sin cambiar el core.

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
APP_PORT=3000
API_PREFIX=api/v1
CORS_ORIGINS=http://localhost:3000,http://localhost:5173
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

## Bootstrap de base de datos al arrancar

```env
DATABASE_BOOTSTRAP_ON_STARTUP=true
DATABASE_BOOTSTRAP_FAIL_FAST=true
DATABASE_SEED_PUBLIC_CMS_ON_STARTUP=true
```

Al arrancar, si `DATABASE_BOOTSTRAP_ON_STARTUP=true` (default), el backend crea columnas/tablas/vistas
de compatibilidad que falten sin borrar datos existentes — pensado para bases ya desplegadas que
quedaron desalineadas del schema esperado. `DATABASE_BOOTSTRAP_FAIL_FAST=true` hace que el arranque
falle si el bootstrap no puede completarse, en vez de seguir con un schema parcialmente aplicado.
`DATABASE_SEED_PUBLIC_CMS_ON_STARTUP` siembra datos públicos mínimos (p. ej. contenido/CMS) si faltan.
Apaga estas variables solo si administras el schema exclusivamente por migraciones y prefieres que
un drift de schema falle explícitamente en vez de autocorregirse.

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
```

Si `MONGO_DB_URL_CONNECTION` esta vacio, la sincronizacion queda desactivada. En el primer arranque
sin historico remoto, `LOG_SYNC_IMPORT_EXISTING_ON_FIRST_BOOT=false` evita duplicar un `Archivo.log`
ya existente y empieza desde el final del archivo; los siguientes updates continuan desde el ultimo
`offsetTo` guardado en Mongo.

## Matriz de proveedores soportados

| Canal | Provider env | Valores soportados | Credenciales requeridas |
|---|---|---|---|
| `in_app` | no aplica | backend ATLAS | ninguna |
| `email` | `NOTIFICATION_EMAIL_PROVIDER` | `disabled`, `resend`, `sendgrid`, `gmail_api`, `webhook` | según proveedor |
| `push` | `NOTIFICATION_PUSH_PROVIDER` | `disabled`, `fcm`, `webhook` | según proveedor |
| `sms` | `NOTIFICATION_SMS_PROVIDER` | `disabled`, `twilio`, `webhook` | según proveedor |
| `whatsapp` | `NOTIFICATION_WHATSAPP_PROVIDER` | `disabled`, `meta_cloud`, `twilio`, `webhook` | según proveedor |
| `phone` | `NOTIFICATION_PHONE_PROVIDER` | `disabled`, `webhook` | webhook |

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
