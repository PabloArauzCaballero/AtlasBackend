---
title: "internal-portal"
type: "domain"
status: "verified"
owner: "@PabloArauzCaballero"
criticality: "medium"
last_reviewed: "2026-08-06"
source_revision: "670e9b2"
domain: "internal-portal"
module: "InternalPortalModule"
tags:
  - "backend"
  - "domain"
  - "module/internal-portal"
source_files:
  - "src/modules/internal-portal/internal-portal.module.ts"
  - "src/modules/internal-portal/admin-read.controller.ts"
  - "src/modules/internal-portal/internal-portal.controller.ts"
endpoints:
  - "GET /internal/views/customers"
  - "GET /internal/views/risk-assessments"
  - "GET /internal/views/work-queue"
  - "GET /internal/views/provider-health"
  - "GET /internal/views/notification-deliveries"
  - "GET /internal/views/endpoint-coverage"
  - "GET /internal/views/audit-events"
  - "GET /internal/business-metadata/glossary"
  - "GET /internal/business-metadata/terms/:termId"
  - "GET /internal/exports"
  - "GET /internal/exports/:exportId"
  - "GET /internal/data-quality/rules"
  - "GET /internal/data-quality/rules/:ruleId"
  - "POST /internal/data-quality/rules/:ruleId/run"
  - "GET /internal/governance/policies/:policyId"
  - "PATCH /internal/governance/policies/:policyId"
  - "GET /internal/lineage"
  - "GET /internal/lineage/nodes/:nodeId"
  - "GET /internal/lineage/impact"
  - "GET /internal/alerts"
  - "POST /internal/alerts/:alertId/acknowledge"
  - "GET /internal/jobs"
  - "GET /internal/jobs/:jobRunId"
  - "POST /internal/jobs/:jobRunId/retry"
  - "POST /internal/jobs/:jobRunId/cancel"
  - "GET /internal/release-readiness"
  - "GET /internal/reports"
  - "GET /internal/reports/:reportId"
  - "POST /internal/reports/:reportId/run"
  - "GET /internal/reports/:reportId/snapshots"
  - "GET /internal/search"
dependencies: []
---
# Módulo `internal-portal`

Esta pieza ofrece a operaciones una vista gobernada del negocio sin acceso directo a tablas sensibles.

**Papel técnico:** compone consultas read-only, reportes, glosario, linaje y búsqueda para el portal administrativo.

| | |
|---|---|
| Clase | `InternalPortalModule` |
| Archivos | 17 |
| Controllers | 2 |
| Rutas HTTP | 31 |
| Modelos usados | 0 |
| Esquemas de datos | — |

## Entradas

31 rutas HTTP. Contrato completo en [[04-api/rest/internal-admin-views\|internal-admin-views]], [[04-api/rest/internal-portal\|internal-portal]].

| Método | Ruta | Auth | Roles |
|---|---|---|---|
| `GET` | `/internal/views/customers` | 🔒 | `...ADMIN_READ_ROLES` |
| `GET` | `/internal/views/risk-assessments` | 🔒 | `...ADMIN_READ_ROLES` |
| `GET` | `/internal/views/work-queue` | 🔒 | `...ADMIN_READ_ROLES` |
| `GET` | `/internal/views/provider-health` | 🔒 | `...ADMIN_READ_ROLES` |
| `GET` | `/internal/views/notification-deliveries` | 🔒 | `...ADMIN_READ_ROLES` |
| `GET` | `/internal/views/endpoint-coverage` | 🔒 | `...ADMIN_READ_ROLES` |
| `GET` | `/internal/views/audit-events` | 🔒 | `...ADMIN_READ_ROLES` |
| `GET` | `/internal/business-metadata/glossary` | 🔒 | `...INTERNAL_PORTAL_ROLES` |
| `GET` | `/internal/business-metadata/terms/:termId` | 🔒 | `...INTERNAL_PORTAL_ROLES` |
| `GET` | `/internal/exports` | 🔒 | `...INTERNAL_PORTAL_ROLES` |
| `GET` | `/internal/exports/:exportId` | 🔒 | `...INTERNAL_PORTAL_ROLES` |
| `GET` | `/internal/data-quality/rules` | 🔒 | `...INTERNAL_PORTAL_ROLES` |
| `GET` | `/internal/data-quality/rules/:ruleId` | 🔒 | `...INTERNAL_PORTAL_ROLES` |
| `POST` | `/internal/data-quality/rules/:ruleId/run` | 🔒 | `...INTERNAL_PORTAL_ROLES` |
| `GET` | `/internal/governance/policies/:policyId` | 🔒 | `...INTERNAL_PORTAL_ROLES` |
| `PATCH` | `/internal/governance/policies/:policyId` | 🔒 | `...INTERNAL_PORTAL_ROLES` |
| `GET` | `/internal/lineage` | 🔒 | `...INTERNAL_PORTAL_ROLES` |
| `GET` | `/internal/lineage/nodes/:nodeId` | 🔒 | `...INTERNAL_PORTAL_ROLES` |
| `GET` | `/internal/lineage/impact` | 🔒 | `...INTERNAL_PORTAL_ROLES` |
| `GET` | `/internal/alerts` | 🔒 | `...INTERNAL_PORTAL_ROLES` |
| `POST` | `/internal/alerts/:alertId/acknowledge` | 🔒 | `...INTERNAL_PORTAL_ROLES` |
| `GET` | `/internal/jobs` | 🔒 | `...INTERNAL_PORTAL_ROLES` |
| `GET` | `/internal/jobs/:jobRunId` | 🔒 | `...INTERNAL_PORTAL_ROLES` |
| `POST` | `/internal/jobs/:jobRunId/retry` | 🔒 | `...INTERNAL_PORTAL_ROLES` |
| `POST` | `/internal/jobs/:jobRunId/cancel` | 🔒 | `...INTERNAL_PORTAL_ROLES` |
| `GET` | `/internal/release-readiness` | 🔒 | `...INTERNAL_PORTAL_ROLES` |
| `GET` | `/internal/reports` | 🔒 | `...INTERNAL_PORTAL_ROLES` |
| `GET` | `/internal/reports/:reportId` | 🔒 | `...INTERNAL_PORTAL_ROLES` |
| `POST` | `/internal/reports/:reportId/run` | 🔒 | `...INTERNAL_PORTAL_ROLES` |
| `GET` | `/internal/reports/:reportId/snapshots` | 🔒 | `...INTERNAL_PORTAL_ROLES` |
| `GET` | `/internal/search` | 🔒 | `...INTERNAL_PORTAL_ROLES` |

## Salidas y efectos

`INFERIDO` — no registra modelos propios; opera sobre datos de otros módulos o sobre infraestructura.

## Dependencias

**Depende de:** ningún otro módulo de negocio — es un módulo hoja.

**Del que dependen:** ningún módulo de negocio lo importa.

**Exporta:** nada — su capacidad no es accesible desde otros módulos.

## Estructura interna

| Capa | Archivos |
|---|---|
| Controllers | `admin-read.controller.ts`, `internal-portal.controller.ts` |
| Services | `internal-portal.service.ts`, `application/admin-read.service.ts`, `application/portal-data-quality.service.ts`, `application/portal-glossary.service.ts`, `application/portal-governance.service.ts`, `application/portal-lineage.service.ts`, `application/portal-operations.service.ts`, `application/portal-reports.service.ts`, `application/portal-search.service.ts` |
| Repositories | — |
| Esquemas Zod | `admin-read.schemas.ts` |
| Mappers | — |

## Autorización

Roles que alcanzan este módulo: `...ADMIN_READ_ROLES`, `...INTERNAL_PORTAL_ROLES`.


## Pruebas

4 archivo(s) de test:

- `test/unit/internal-portal/admin-read.service.spec.ts`
- `test/unit/internal-portal/internal-portal-business-term.spec.ts`
- `test/unit/internal-portal/internal-portal-roles.spec.ts`
- `test/unit/internal-portal/internal-portal-service-contract.spec.ts`

## Referencias al código

- Módulo: [`src/modules/internal-portal/internal-portal.module.ts`](../../../../../src/modules/internal-portal/internal-portal.module.ts)
- Controller `AdminReadController`: [`src/modules/internal-portal/admin-read.controller.ts`](../../../../../src/modules/internal-portal/admin-read.controller.ts)
- Controller `InternalPortalController`: [`src/modules/internal-portal/internal-portal.controller.ts`](../../../../../src/modules/internal-portal/internal-portal.controller.ts)

## Relaciones

- [[03-domains/index]] · [[02-architecture/dependency-map]] · [[13-change-impact/dependency-impact-map]]
