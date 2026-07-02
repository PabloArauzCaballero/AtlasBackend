# NotificationsModule

Motor central de notificaciones para ATLAS.

## Principio

El backend conserva la verdad en `notification_messages`. Los canales externos se resuelven con adapters configurables por ambiente.

## Canales implementados

- `in_app`: funcional en base de datos ATLAS.
- `email`: adapter real configurable por `resend`, `sendgrid`, `gmail_api` o `webhook`.
- `push`: adapter real configurable por `fcm` o `webhook`.
- `sms`: adapter real configurable por `twilio` o `webhook`.
- `whatsapp`: adapter real configurable por `meta_cloud`, `twilio` o `webhook`.

Los proveedores quedan desactivados por defecto para evitar envíos accidentales. Para enviar externamente se configura el provider y sus credenciales en `.env`.
