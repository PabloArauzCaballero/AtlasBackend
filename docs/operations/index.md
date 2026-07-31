# Operación

| Si buscas | Ve a |
|---|---|
| Desplegar a producción | [Runbook de despliegue](../runbooks/despliegue-produccion.md) |
| Qué corre solo y dónde | [Procesamiento en segundo plano](../architecture/background-processing.md) |
| Métricas, logs y alertas | [Observabilidad](../observability/overview.md) |
| Variables de entorno | [Configuración](../config/environment.md) |

## Topología

Una sola imagen, tres roles. Ver [ADR-0006](../adr/0006-separacion-de-roles-api-worker.md).

| Rol | `APP_ROLE` | Comando | Escala por |
|---|---|---|---|
| API | `api` | `node dist/src/main.js` | Tráfico |
| Worker | `worker` | `node dist/src/worker.js` | 1 réplica basta; más sólo por tolerancia a fallos |
| Migraciones | `all` | `node dist/src/database/migrate.js up` | One-shot, antes que los otros dos |

## Sondas

| Rol | Liveness | Readiness |
|---|---|---|
| `api` | `/api/v1/health/liveness` | `/api/v1/health/readiness` |
| `worker` | `:3006/health/liveness` | `:3006/health/readiness` |

Readiness responde **503 durante el drenado** por SIGTERM. Es lo que retira la instancia del
balanceador antes de que se cierre, y por eso `SHUTDOWN_DRAIN_MS` debe superar el intervalo del probe.

## Comprobaciones rápidas

```bash
# Qué build está desplegado
curl -s https://api.atlas.local/api/v1/health | jq '.data | {version, commit, builtAt}'

# Ambos roles vivos (si falta una serie, ese rol no corre)
curl -s http://worker:3006/metrics | grep atlas_app_info

# El trabajo de fondo avanza
curl -s http://worker:3006/metrics | grep atlas_scheduled_job_runs_total

# El outbox no se acumula
curl -s http://worker:3006/metrics | grep atlas_outbox_pending_events
```
