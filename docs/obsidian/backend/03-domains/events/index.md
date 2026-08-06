---
title: "events"
type: "domain"
status: "verified"
owner: "unknown"
criticality: "medium"
last_reviewed: "2026-08-06"
source_revision: "670e9b2"
domain: "events"
module: "EventsModule"
tags:
  - "backend"
  - "domain"
  - "module/events"
source_files:
  - "src/modules/events/events.module.ts"
  - "src/modules/events/events.controller.ts"
endpoints:
  - "GET /operations/events/catalog"
  - "GET /operations/events"
  - "GET /operations/events/:eventId"
  - "POST /operations/events"
  - "POST /operations/events/:eventId/retry"
  - "POST /operations/events/:eventId/cancel"
dependencies:
  - "NotificationsModule"
---
# Módulo `events`

Esta pieza desacopla procesos de negocio y permite reintentos auditables sin perder eventos.

**Papel técnico:** registra definiciones, outbox y procesamiento idempotente de eventos de dominio.

| | |
|---|---|
| Clase | `EventsModule` |
| Archivos | 8 |
| Controllers | 1 |
| Rutas HTTP | 6 |
| Modelos usados | 1 |
| Esquemas de datos | [[platform_ops-schema\|platform_ops]] |

## Entradas

6 rutas HTTP. Contrato completo en [[04-api/rest/events\|events]].

| Método | Ruta | Auth | Roles |
|---|---|---|---|
| `GET` | `/operations/events/catalog` | 🔒 | `internal_operator` `risk_analyst` `compliance_analyst` `fraud_analyst` |
| `GET` | `/operations/events` | 🔒 | `internal_operator` `risk_analyst` `compliance_analyst` `fraud_analyst` |
| `GET` | `/operations/events/:eventId` | 🔒 | `internal_operator` `risk_analyst` `compliance_analyst` `fraud_analyst` |
| `POST` | `/operations/events` | 🔒 | `internal_operator` `risk_analyst` `compliance_analyst` `fraud_analyst` |
| `POST` | `/operations/events/:eventId/retry` | 🔒 | `internal_operator` `risk_analyst` `compliance_analyst` `fraud_analyst` |
| `POST` | `/operations/events/:eventId/cancel` | 🔒 | `internal_operator` `risk_analyst` `compliance_analyst` `fraud_analyst` |

## Salidas y efectos

Persiste en 1 tabla(s):

- [[outbox_events]] (`platform_ops`)

## Dependencias

**Depende de:** [[03-domains/notifications/index\|notifications]]

**Del que dependen:** [[03-domains/runtime-jobs/index\|runtime-jobs]]

**Exporta:** `EventsService`

## Estructura interna

| Capa | Archivos |
|---|---|
| Controllers | `events.controller.ts` |
| Services | `events.service.ts` |
| Repositories | `events.repository.ts` |
| Esquemas Zod | `events.schemas.ts` |
| Mappers | — |

## Autorización

Roles que alcanzan este módulo: `internal_operator`, `risk_analyst`, `compliance_analyst`, `fraud_analyst`, `admin`, `platform_admin`, `system`.


## Pruebas

4 archivo(s) de test:

- `test/unit/events/events.controller.spec.ts`
- `test/unit/events/events.repository.spec.ts`
- `test/unit/events/events.service.spec.ts`
- `test/unit/events/reclaim-stuck-events.spec.ts`

## Referencias al código

- Módulo: [`src/modules/events/events.module.ts`](../../../../src/modules/events/events.module.ts)
- Controller `EventsController`: [`src/modules/events/events.controller.ts`](../../../../src/modules/events/events.controller.ts)

## Relaciones

- [[03-domains/index]] · [[02-architecture/dependency-map]] · [[13-change-impact/dependency-impact-map]]
