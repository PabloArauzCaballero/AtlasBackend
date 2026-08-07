---
title: "API — runtime-jobs"
type: "api"
status: "verified"
owner: "@PabloArauzCaballero"
criticality: "high"
last_reviewed: "2026-08-06"
source_revision: "80fc741"
tags:
  - "backend"
  - "api"
  - "rest"
  - "tag/runtime-jobs"
source_files:
  - "src/modules/runtime-jobs/runtime-jobs.controller.ts"
endpoints:
  - "POST /operations/jobs/process-outbox"
  - "POST /operations/jobs/process-events"
  - "POST /operations/jobs/expire-stale-sessions"
  - "POST /operations/jobs/retry-stuck-notifications"
  - "POST /operations/jobs/deliver-pending-notifications"
  - "POST /operations/jobs/reclaim-stuck-events"
  - "POST /operations/jobs/purge-idempotency-keys"
  - "POST /operations/jobs/apply-retention-policies"
  - "POST /operations/jobs/recalculate-data-quality"
---
# API — `runtime-jobs`

9 endpoint(s), todos autenticados.

> [!info] Verificado
> Rutas extraídas de los decoradores `@Controller`/`@Get`/`@Post`… de 1 archivo(s). Todas las rutas cuelgan del prefijo global `${API_PREFIX}` (por defecto `api/v1`), salvo `/metrics`.

## Endpoints

| Método | Ruta | Auth | Roles | Rate limit | Códigos | Propósito |
|---|---|---|---|---|---|---|
| `POST` | `/operations/jobs/process-outbox` | 🔒 JWT | `admin`<br>`platform_admin`<br>`system` | — | 200 | Procesar el outbox de eventos pendientes |
| `POST` | `/operations/jobs/process-events` | 🔒 JWT | `admin`<br>`platform_admin`<br>`system` | — | 200 | Procesar eventos de dominio pendientes |
| `POST` | `/operations/jobs/expire-stale-sessions` | 🔒 JWT | `admin`<br>`platform_admin`<br>`system` | — | 200 | Expirar sesiones inactivas |
| `POST` | `/operations/jobs/retry-stuck-notifications` | 🔒 JWT | `admin`<br>`platform_admin`<br>`system` | — | 200 | Reintentar notificaciones atascadas |
| `POST` | `/operations/jobs/deliver-pending-notifications` | 🔒 JWT | `admin`<br>`platform_admin`<br>`system` | — | 200 | Entregar notificaciones pendientes |
| `POST` | `/operations/jobs/reclaim-stuck-events` | 🔒 JWT | `admin`<br>`platform_admin`<br>`system` | — | 200 | Recuperar eventos varados en processing |
| `POST` | `/operations/jobs/purge-idempotency-keys` | 🔒 JWT | `admin`<br>`platform_admin`<br>`system` | — | 200 | Purgar claves de idempotencia resueltas |
| `POST` | `/operations/jobs/apply-retention-policies` | 🔒 JWT | `admin`<br>`platform_admin`<br>`system` | — | 200 | Aplicar políticas de retención de datos |
| `POST` | `/operations/jobs/recalculate-data-quality` | 🔒 JWT | `admin`<br>`platform_admin`<br>`system` | — | 200 | Recalcular métricas de calidad de datos |



## Contrato

- Convenciones comunes (envoltura de respuesta, correlación, paginación): [[04-api/conventions]]
- Modelo de error: [[04-api/error-model]]
- Autenticación: [[04-api/authentication]] · Autorización: [[04-api/authorization]]
- Contrato OpenAPI generado: [`docs/endpoints/openapi.yaml`](../../../../endpoints/openapi.yaml)

## Evidencia

- [`src/modules/runtime-jobs/runtime-jobs.controller.ts`](../../../../../src/modules/runtime-jobs/runtime-jobs.controller.ts)

## Relaciones

- Catálogo global: [[15-reference/endpoint-catalog]]
- Índice de API: [[04-api/index]]
