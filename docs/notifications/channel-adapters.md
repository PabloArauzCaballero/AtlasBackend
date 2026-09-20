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

### SendGrid (el correo de Twilio)

```env
NOTIFICATION_EMAIL_PROVIDER=sendgrid
SENDGRID_API_KEY=...
SENDGRID_FROM_EMAIL=no-reply@atlas.bo
SENDGRID_FROM_NAME=ATLAS                 # opcional
SENDGRID_REPLY_TO_EMAIL=soporte@atlas.bo # opcional; el payload puede pisarlo con `replyTo`
SENDGRID_EVENT_WEBHOOK_PUBLIC_KEY=...    # sin esto, el webhook de eventos responde 401
```

Twilio no tiene una API de correo propia: su producto de correo ES SendGrid, así que «mandar correo
por Twilio» y `NOTIFICATION_EMAIL_PROVIDER=sendgrid` son lo mismo.

Qué manda el adaptador, y por qué importa:

- **Texto y HTML**, en ese orden. SendGrid exige `text/plain` antes que `text/html` y responde 400 al
  revés. El HTML sale de `payload.html` o `payload.htmlBody`; sin él va sólo texto.
- **`custom_args.atlas_message_id`**, que SendGrid devuelve en CADA evento del webhook. Es lo que
  permite atribuir un rebote a su mensaje sin cruzar identificadores decorados.
- El identificador que se guarda en `provider_message_id` sale de la cabecera **`X-Message-Id`**: un
  envío aceptado responde `202` con cuerpo vacío.

### Gmail API

```env
NOTIFICATION_EMAIL_PROVIDER=gmail_api
GMAIL_CLIENT_ID=...
GMAIL_CLIENT_SECRET=...
GMAIL_REFRESH_TOKEN=...
GMAIL_FROM_EMAIL=...
```

A diferencia de Resend/SendGrid, Gmail no es una llamada HTTP con API key: `EmailNotificationAdapter`
delega el canal en `GmailApiAdapter` (`src/modules/notifications/adapters/gmail/`), que aporta lo que
la API de Google exige y los demás proveedores no:

- **Canje OAuth2 cacheado** (`GmailOAuthTokenService`): el `refresh_token` se cambia por un access
  token una vez por hora, no una vez por correo, y los envíos concurrentes en frío comparten un único
  canje. Un `401` de Gmail —token revocado antes de expirar— invalida el cache y reintenta una sola
  vez con token fresco.
- **Construcción MIME propia** (`gmail-mime.util.ts`): el campo `raw` de `users.messages.send` es un
  mensaje RFC 5322 completo. Incluye asuntos no ASCII en RFC 2047 (plegados y sin partir caracteres
  multibyte), `multipart/alternative` cuando el payload trae `html`, cuerpos en base64 a 76 columnas
  y saneo anti inyección de cabeceras.
- **Direcciones validadas** antes de armar el mensaje: una coma o un salto de línea en un
  destinatario permitiría inventar copias ocultas. El error reporta el conteo, nunca la dirección
  (es PII y termina persistida en `notification_deliveries`).

El payload de la notificación admite además `html`/`htmlBody`, `cc`, `bcc` y `replyTo`. Para envíos
transaccionales puntuales, `GmailApiAdapter.sendEmail()` está exportado por `NotificationsModule` y
expone esos campos de forma tipada.

Prerrequisitos en Google Cloud: la Gmail API habilitada en el proyecto y el refresh token emitido
para el scope `https://www.googleapis.com/auth/gmail.send` con la cuenta de `GMAIL_FROM_EMAIL`.

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
TWILIO_SMS_FROM=+10000000000       # o, mejor, un Messaging Service:
TWILIO_MESSAGING_SERVICE_SID=MG... # si está, sustituye a TWILIO_SMS_FROM (mandar los dos es un 400)
TWILIO_STATUS_CALLBACK_URL=https://<host público>/api/v1/internal/notifications/twilio-status
NOTIFICATION_DEFAULT_COUNTRY_CODE=+591
```

- **El destinatario se normaliza a E.164** (`70000000` → `+59170000000`) con
  `NOTIFICATION_DEFAULT_COUNTRY_CODE`. Twilio rechaza cualquier otro formato con `21211` y cobra el
  intento.
- **Un rechazo del destinatario se distingue de un fallo de envío**: los códigos `21211`, `21610`
  (baja voluntaria), `21614` y compañía devuelven `TWILIO_SMS_RECIPIENT_REJECTED`, que no se arregla
  reintentando. El resto devuelve `TWILIO_SMS_SEND_FAILED`. El cuerpo completo del error de Twilio
  queda en `response_payload_json.providerResponse`.

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

## Callbacks de estado (entregado / rebotado)

Sin ellos, toda entrega se queda en `sent` para siempre: un número apagado se ve igual que uno que
recibió el mensaje. Los dos endpoints son **públicos respecto al guard de sesión** —quien llama es un
proveedor, no una persona con token— y lo que los autentica es la FIRMA. Sin secreto configurado
responden `401`, nunca aceptan a ciegas.

| Endpoint | Proveedor | Cómo se autentica |
| --- | --- | --- |
| `POST /api/v1/internal/notifications/twilio-status` | Twilio (SMS y WhatsApp) | `X-Twilio-Signature`: HMAC-SHA1 con el token de cuenta sobre la URL + parámetros ordenados |
| `POST /api/v1/internal/notifications/sendgrid-events` | SendGrid | Firma ECDSA sobre `timestamp + cuerpo CRUDO`, con ventana de 10 min contra repetición |

Tres cosas que rompen estos webhooks en silencio:

1. **La URL de Twilio tiene que ser EXACTAMENTE la registrada.** Se firma la URL completa; detrás de
   un proxy que termina TLS, reconstruirla desde la petición da `http` donde Twilio firmó `https` y la
   verificación falla siempre. Por eso se usa `TWILIO_STATUS_CALLBACK_URL` y no `req`.
2. **SendGrid se verifica sobre el cuerpo crudo.** `main.ts` lo conserva SÓLO para esa ruta; sobre el
   JSON re-serializado la firma no cuadra nunca.
3. **Gana el primer estado terminal.** Los dos proveedores reintentan y mandan varios avisos por
   mensaje; un aviso repetido o tardío no pisa un desenlace ya escrito. Un mensaje que el
   destinatario ya leyó (`read`) tampoco vuelve atrás.

Qué se traduce y qué se ignora a propósito: de Twilio, sólo `delivered`/`read` y
`undelivered`/`failed`/`canceled` (`queued`, `sending` y `sent` repiten lo que ya se sabía). De
SendGrid, `delivered` y `bounce`/`dropped`/`blocked`; `deferred` es un reintento en curso, no un
fallo, y `open`, `click`, `spamreport` y `unsubscribe` hablan de la conducta del destinatario, no de
la entrega.

## Privacidad

- El payload general se guarda redactado.
- Los destinos sensibles de envío se guardan cifrados en `delivery_targets_json`.
- Los tokens FCM se guardan cifrados en `device_tokens.token_encrypted`, más `token_hash` para deduplicación.
- En push, evita mandar montos, deuda, mora o datos sensibles en el payload. Envía solo `notificationMessageId` y consulta el detalle al backend.

## Alcance actual

- Amazon SES no está implementado como adapter de primer nivel. Puede conectarse mediante `webhook` o implementarse después como `ses`.
- WhatsApp en producción normalmente requiere templates aprobados. El core soporta template fallback; el mapeo formal por evento/template_code contra templates aprobados corresponde a la activación del proveedor.
