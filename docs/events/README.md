# Patch 2.0 — Events Core

ATLAS ahora tiene una capa central para eventos de negocio sobre `outbox_events`.

## Flujo

```txt
dominio / controller
→ EventsService.publish
→ outbox_events
→ POST /operations/jobs/process-events
→ NotificationOrchestrator
→ notification_messages
→ adapter abstracto
→ notification_deliveries
```

## Decisión clave

No se creó `event_outbox` porque el backend ya tenía `outbox_events`. El patch extiende esa tabla y evita una arquitectura paralela.

## Endpoints

- `GET /operations/events/catalog`
- `GET /operations/events`
- `GET /operations/events/:eventId`
- `POST /operations/events`
- `POST /operations/events/:eventId/retry`
- `POST /operations/events/:eventId/cancel`
- `POST /operations/jobs/process-events`

Las escrituras requieren `X-Idempotency-Key`.
