# Outbox flow

El patch usa un worker DB-backed porque el backend ya tenía `outbox_events`, `system_job_runs` y `process-outbox`.

## Estados

- `pending`
- `processing`
- `processed`
- `failed`
- `cancelled`

## Reintentos

Si un evento falla y no supera `max_attempts`, vuelve a `pending` con backoff.
Si supera `max_attempts`, queda `failed` y puede reintentarse manualmente.

## Idempotencia

`_tenant_id + event_code + idempotency_key` evita procesar intenciones duplicadas cuando el cliente reintenta una acción.
