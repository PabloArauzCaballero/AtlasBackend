# Retry policy

Eventos:

- Controlados por `outbox_events.attempts` y `max_attempts`.
- Backoff cuadrático simple en DB.

Mensajes:

- Pueden reintentarse desde `POST /operations/notifications/messages/:messageId/retry`.
- Cada intento queda en `notification_deliveries`.
