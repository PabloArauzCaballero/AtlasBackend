# Channel adapters

ATLAS separa **canal** de **proveedor**.

## Canales

- `in_app`: bandeja interna web/app. No requiere proveedor externo.
- `email`: correo transaccional.
- `push`: push mobile/web.
- `sms`: mensaje SMS.
- `whatsapp`: WhatsApp Business.
- `phone`: llamada telefónica o proveedor de call center vía webhook.

## Implementación actual

| Canal | Adapter | Estado |
|---|---|---|
| `in_app` | `InAppNotificationAdapter` | funcional dentro de ATLAS |
| `email` | `EmailNotificationAdapter` | Resend, SendGrid, Gmail API o webhook |
| `push` | `PushNotificationAdapter` | Firebase Cloud Messaging o webhook |
| `sms` | `SmsNotificationAdapter` | Twilio SMS o webhook |
| `whatsapp` | `WhatsAppNotificationAdapter` | Meta WhatsApp Cloud API, Twilio WhatsApp o webhook |
| `phone` | `PhoneNotificationAdapter` | webhook |

## Configuración

```env
NOTIFICATION_EMAIL_PROVIDER=disabled # disabled|resend|sendgrid|gmail_api|webhook
NOTIFICATION_PUSH_PROVIDER=disabled # disabled|fcm|webhook
NOTIFICATION_SMS_PROVIDER=disabled # disabled|twilio|webhook
NOTIFICATION_WHATSAPP_PROVIDER=disabled # disabled|meta_cloud|twilio|webhook
NOTIFICATION_PHONE_PROVIDER=disabled # disabled|webhook
```

`disabled` no es mock: significa que el canal queda apagado y cualquier intento queda registrado como delivery fallido con error de configuración. Esto evita falsos positivos.

## Webhooks

Puedes configurar un webhook genérico o un webhook por canal:

```env
NOTIFICATION_WEBHOOK_URL=
NOTIFICATION_EMAIL_WEBHOOK_URL=
NOTIFICATION_PUSH_WEBHOOK_URL=
NOTIFICATION_SMS_WEBHOOK_URL=
NOTIFICATION_WHATSAPP_WEBHOOK_URL=
NOTIFICATION_PHONE_WEBHOOK_URL=
```

Resolución:

```txt
webhook específico del canal
→ fallback a NOTIFICATION_WEBHOOK_URL
→ error WEBHOOK_URL_MISSING
```

Esto permite correr pruebas de integración para todos los canales sin activar proveedores reales todavía.

## Credenciales por proveedor

### Resend

```env
NOTIFICATION_EMAIL_PROVIDER=resend
RESEND_API_KEY=...
RESEND_FROM_EMAIL=no-reply@atlas.bo
```

### SendGrid

```env
NOTIFICATION_EMAIL_PROVIDER=sendgrid
SENDGRID_API_KEY=...
SENDGRID_FROM_EMAIL=no-reply@atlas.bo
```

### Gmail API

```env
NOTIFICATION_EMAIL_PROVIDER=gmail_api
GMAIL_CLIENT_ID=...
GMAIL_CLIENT_SECRET=...
GMAIL_REFRESH_TOKEN=...
GMAIL_FROM_EMAIL=...
```

### Firebase Cloud Messaging

```env
NOTIFICATION_PUSH_PROVIDER=fcm
FCM_PROJECT_ID=...
FCM_CLIENT_EMAIL=...
FCM_PRIVATE_KEY=-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n
```

### Twilio SMS

```env
NOTIFICATION_SMS_PROVIDER=twilio
TWILIO_ACCOUNT_SID=...
TWILIO_AUTH_TOKEN=...
TWILIO_SMS_FROM=+10000000000
```

### Meta WhatsApp Cloud API

```env
NOTIFICATION_WHATSAPP_PROVIDER=meta_cloud
META_WHATSAPP_TOKEN=...
META_WHATSAPP_PHONE_NUMBER_ID=...
META_WHATSAPP_DEFAULT_TEMPLATE_NAME=
META_WHATSAPP_DEFAULT_TEMPLATE_LANGUAGE=es
```

### Twilio WhatsApp

```env
NOTIFICATION_WHATSAPP_PROVIDER=twilio
TWILIO_ACCOUNT_SID=...
TWILIO_AUTH_TOKEN=...
TWILIO_WHATSAPP_FROM=whatsapp:+10000000000
```

## Timeouts y retries

Los adapters JSON/webhook usan:

```env
NOTIFICATION_PROVIDER_HTTP_TIMEOUT_MS=15000
NOTIFICATION_PROVIDER_HTTP_RETRIES=1
NOTIFICATION_PROVIDER_HTTP_RETRY_BASE_DELAY_MS=250
NOTIFICATION_PUSH_INCLUDE_VISIBLE_NOTIFICATION=false
```

No subas retries sin control: puedes duplicar costo o saturar proveedores si hay una caída externa.

## Privacidad

- El payload general se guarda redactado.
- Los destinos sensibles de envío se guardan cifrados en `delivery_targets_json`.
- Los tokens FCM se guardan cifrados en `device_tokens.token_encrypted`, más `token_hash` para deduplicación.
- En push, evita mandar montos, deuda, mora o datos sensibles en el payload. Envía solo `notificationMessageId` y consulta el detalle al backend.

## Alcance actual

- Amazon SES no está implementado como adapter de primer nivel. Puede conectarse mediante `webhook` o implementarse después como `ses`.
- WhatsApp en producción normalmente requiere templates aprobados. El core soporta template fallback; el mapeo formal por evento/template_code contra templates aprobados corresponde a la activación del proveedor.
