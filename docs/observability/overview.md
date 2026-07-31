# Observabilidad

Tres señales, cada una con una pregunta distinta: los **logs** dicen qué pasó en una petición, las
**métricas** dicen si el sistema está sano, y las **trazas** dicen dónde se fue el tiempo.

---

## Logs

Formato controlado por `LOG_FORMAT`. En producción el default es `json`.

```json
{"ts":"2026-07-31T13:55:34.987Z","level":"log","context":"RuntimeJobsSchedulerService",
 "correlationId":"3f9a...","traceId":null,"message":"Job process_outbox programado cada 30000 ms."}
```

| Campo | Siempre | Para qué |
|---|---|---|
| `ts` | Sí | Momento, UTC |
| `level` | Sí | `log` / `warn` / `error` |
| `context` | Sí | Clase que emitió |
| `correlationId` | En peticiones | Une la línea con la respuesta que vio el cliente |
| `traceId` | Con OTel activo | Une la línea con la traza distribuida |

### Redacción de PII

`redactSensitiveText` se aplica **antes de escribir**, tanto al archivo como a stdout.

!!! danger "Por qué stdout también"
    `AppFileLogger` redactaba la PII del archivo pero llamaba antes a `super.log(...)`, que imprimía
    el mensaje crudo por stdout — el canal que en un contenedor recoge el agregador de logs. Era el
    hallazgo A-04: la redacción existía y no servía de nada.

Reglas relacionadas:

- **Nunca se registra SQL.** Sequelize inlinea los valores en la consulta, y en un backend KYC esos
  valores son PII.
- **La query string se sanea**: se conservan los nombres de los parámetros y se descartan sus valores.

### Cada proceso sincroniza su propio archivo

`ArchivoLogMongoSyncService` tail-ea el archivo que escribe **su** proceso, por eso corre en `api`
**y** en `worker`. El `bootId` de cada proceso distingue el origen de cada documento en MongoDB.

---

## Métricas

`GET /metrics` (API) y `:3006/metrics` (worker), en formato Prometheus.

| Métrica | Tipo | Qué responde |
|---|---|---|
| `http_requests_total{method,route,status_code}` | counter | Volumen y tasa de error |
| `http_request_duration_seconds` | histogram | Latencia p50/p95/p99 |
| `atlas_app_info{role,version,commit}` | gauge | **Qué roles están vivos y con qué build** |
| `atlas_db_pool_connections{state}` | gauge | Saturación del pool. `waiting > 0` sostenido = handlers esperando conexión |
| `atlas_outbox_pending_events{tenant_id}` | gauge | Profundidad del backlog de eventos |
| `atlas_scheduled_job_runs_total{job,outcome}` | counter | Que el trabajo de fondo corre y con qué resultado |
| `atlas_auth_attempts_total{actor_type,outcome}` | counter | Patrones de credential stuffing |
| `atlas_provider_calls_total{provider,outcome}` | counter | Coste: cada llamada a un buró se cobra |
| `atlas_circuit_breaker_state{provider}` | gauge | 0=cerrado, 1=semiabierto, 2=abierto |

!!! warning "`/metrics` no lleva autenticación de aplicación"
    Debe quedar restringido a la red interna de scrape. En `docker-compose.prod.yml` el puerto del
    worker **no se publica** por esa razón.

### Por qué existe `atlas_app_info`

Con la API y el worker desplegados por separado, "el worker no está corriendo" es un fallo
**silencioso**: nadie recibe un error, simplemente el outbox deja de despacharse y la retención de
datos personales deja de aplicarse. `absent(atlas_app_info{role="worker"})` convierte ese silencio en
una alerta.

---

## Trazas

OpenTelemetry, **apagado por defecto** (`OTEL_ENABLED=false`, coste cero). Con `OTEL_ENABLED=true` y
`OTEL_EXPORTER_OTLP_ENDPOINT` configurado, se instrumentan HTTP, Express y PostgreSQL, y el `traceId`
aparece en cada línea de log.

El flush de spans al apagar está enganchado a SIGTERM y SIGINT: sin él, la última traza antes de un
despliegue se pierde justo cuando más se necesita.

---

## Alertas

19 reglas en [`prometheus-alerts.yml`](../../ops/observability/prometheus-alerts.yml). Las que cubren
fallos que de otro modo serían invisibles:

| Alerta | Severidad | Qué detecta |
|---|---|---|
| `AtlasWorkerRoleAbsent` | critical | Nadie ejecuta trabajo de fondo |
| `AtlasApiRoleAbsent` | critical | Nadie atiende la API |
| `AtlasPendingNotificationDeliveryJobNotRunning` | critical | En modo diferido, los broadcasts se persisten pero no llegan |
| `AtlasRetentionJobNotRunning` | warning | La retención de datos personales no se aplica |
| `AtlasScheduledJobFailing` | warning | Un job falla en cada tanda |
| `AtlasNotificationRetryJobNotRunning` | warning | Los mensajes varados no se reintentan |
| `AtlasIdempotencyPurgeNotRunning` | warning | `idempotency_keys` crece sin techo |
| `AtlasInvalidPasswordSpike` | warning | Patrón compatible con credential stuffing |

Todas comparten un criterio: alertan sobre **ausencia de señal**, no sólo sobre errores. Un job que
falla y un job que nadie ejecuta se ven igual desde fuera — como silencio.
