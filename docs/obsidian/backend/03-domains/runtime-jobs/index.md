---
title: "runtime-jobs"
type: "domain"
status: "verified"
owner: "@PabloArauzCaballero"
criticality: "high"
last_reviewed: "2026-08-06"
source_revision: "670e9b2"
domain: "runtime-jobs"
module: "RuntimeJobsModule"
tags:
  - "backend"
  - "domain"
  - "module/runtime-jobs"
source_files:
  - "src/modules/runtime-jobs/runtime-jobs.module.ts"
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
dependencies:
  - "EventsModule"
  - "NotificationsModule"
---
# Módulo `runtime-jobs`

Esta pieza completa trabajo asíncrono y recuperable fuera de la latencia del request.

**Papel técnico:** reclama, procesa y reintenta jobs/outbox con locks y métricas operativas.

| | |
|---|---|
| Clase | `RuntimeJobsModule` |
| Archivos | 9 |
| Controllers | 1 |
| Rutas HTTP | 9 |
| Modelos usados | 11 |
| Esquemas de datos | [[customer-schema\|customer]], [[telemetry-schema\|telemetry]], [[audit-schema\|audit]], [[platform_ops-schema\|platform_ops]], [[privacy-schema\|privacy]], [[iam-schema\|iam]] |

## Entradas

9 rutas HTTP. Contrato completo en [[04-api/rest/runtime-jobs\|runtime-jobs]].

| Método | Ruta | Auth | Roles |
|---|---|---|---|
| `POST` | `/operations/jobs/process-outbox` | 🔒 | `admin` `platform_admin` `system` |
| `POST` | `/operations/jobs/process-events` | 🔒 | `admin` `platform_admin` `system` |
| `POST` | `/operations/jobs/expire-stale-sessions` | 🔒 | `admin` `platform_admin` `system` |
| `POST` | `/operations/jobs/retry-stuck-notifications` | 🔒 | `admin` `platform_admin` `system` |
| `POST` | `/operations/jobs/deliver-pending-notifications` | 🔒 | `admin` `platform_admin` `system` |
| `POST` | `/operations/jobs/reclaim-stuck-events` | 🔒 | `admin` `platform_admin` `system` |
| `POST` | `/operations/jobs/purge-idempotency-keys` | 🔒 | `admin` `platform_admin` `system` |
| `POST` | `/operations/jobs/apply-retention-policies` | 🔒 | `admin` `platform_admin` `system` |
| `POST` | `/operations/jobs/recalculate-data-quality` | 🔒 | `admin` `platform_admin` `system` |

## Salidas y efectos

Persiste en 11 tabla(s):

- [[address_gps_observations]] (`customer`)
- [[customer_sessions]] (`telemetry`)
- [[data_quality_issues]] (`audit`)
- [[device_snapshots]] (`telemetry`)
- [[form_field_interaction_events]] (`telemetry`)
- [[operational_audit_logs]] (`audit`)
- [[idempotency_keys]] (`platform_ops`)
- [[outbox_events]] (`platform_ops`)
- [[retention_policies]] (`privacy`)
- [[system_job_runs]] (`platform_ops`)
- [[tenants]] (`iam`)

## Dependencias

**Depende de:** [[03-domains/events/index\|events]], [[03-domains/notifications/index\|notifications]]

**Del que dependen:** ningún módulo de negocio lo importa.

**Exporta:** nada — su capacidad no es accesible desde otros módulos.

## Estructura interna

| Capa | Archivos |
|---|---|
| Controllers | `runtime-jobs.controller.ts` |
| Services | `job-run-recorder.service.ts`, `runtime-jobs-scheduler.service.ts`, `runtime-jobs.service.ts`, `runtime-maintenance-jobs.service.ts` |
| Repositories | — |
| Esquemas Zod | `runtime-jobs.schemas.ts` |
| Mappers | — |

## Autorización

Roles que alcanzan este módulo: `admin`, `platform_admin`, `system`.


## Pruebas

8 archivo(s) de test:

- `test/unit/runtime-jobs/deliver-pending-notifications.spec.ts`
- `test/unit/runtime-jobs/job-run-recorder.service.spec.ts`
- `test/unit/runtime-jobs/job-tick-guard.spec.ts`
- `test/unit/runtime-jobs/runtime-jobs-scheduler.roles.spec.ts`
- `test/unit/runtime-jobs/runtime-jobs-scheduler.service.spec.ts`
- `test/unit/runtime-jobs/runtime-jobs.controller.spec.ts`
- `test/unit/runtime-jobs/runtime-jobs.service.spec.ts`
- `test/unit/runtime-jobs/runtime-maintenance-jobs.service.spec.ts`

## Referencias al código

- Módulo: [`src/modules/runtime-jobs/runtime-jobs.module.ts`](../../../../../src/modules/runtime-jobs/runtime-jobs.module.ts)
- Controller `RuntimeJobsController`: [`src/modules/runtime-jobs/runtime-jobs.controller.ts`](../../../../../src/modules/runtime-jobs/runtime-jobs.controller.ts)

## Relaciones

- [[03-domains/index]] · [[02-architecture/dependency-map]] · [[13-change-impact/dependency-impact-map]]
