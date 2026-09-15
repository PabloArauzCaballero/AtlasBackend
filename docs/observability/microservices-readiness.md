# Observabilidad para la transición (AT-048)

Pruebas: `test/integration/observability/event-trace-propagation.spec.ts`. Código: `src/platform/observability/event-context.ts`,
`MetricsService.recordOutboxRelay`.

## Propagación

- HTTP → outbox: el caso de uso escribe `correlationId` de la petición en el evento (`SequelizeOutboxWriter.append`).
- Outbox → consumidor: el sobre lleva `correlationId` y `causationId`; un evento hijo hereda la correlación y apunta al
  padre (`childContextOf`). Probado con PostgreSQL de punta a punta.
- Trazas OTel: el bootstrap (`tracing-bootstrap.ts`) va antes de cualquier módulo instrumentado; `traceparent` se
  reserva en `EventContext` para viajar en `metadata_json` cuando el transporte sea un broker (AT-056).

## Métricas nuevas y existentes (sin cardinalidad por cliente)

| Métrica | Etiquetas | Qué mide |
|---|---|---|
| `atlas_outbox_relay_events_total` (nueva) | `outcome` (published/retried/dead_lettered/quarantined), `transport` | resultado del relay v2 |
| `atlas_outbox_pending_events` (existente) | `tenant_id` — **deuda**: etiqueta por tenant; aceptable con decenas de tenants, no con miles | backlog |
| `atlas_scheduled_job_runs_total` | `job`, `outcome` | jobs |
| `atlas_idempotency_*` (pendiente AT-054) | `outcome` | rechazos/replays |

`metricLabels` rechaza `tenantId`, `customerId`, `eventId`, `correlationId`… como etiqueta: un panel por cliente se
hace con logs/trazas, no con series.

## Alertas por capacidad (umbrales a fijar desde la línea base de AT-054)

- Edad del evento pendiente más antiguo > N min → relay caído o transporte caído (no pérdida: el evento sigue en el outbox).
- `dead_lettered`/`quarantined` > 0 en 15 min → runbook `events-recovery-v2.md`.
- Backlog creciendo con `published` = 0 → consumidor bloqueado.
- Readiness: la base propia es crítica; Redis (lock de líder) es crítico sólo para el worker; MongoDB de logs es opcional.
