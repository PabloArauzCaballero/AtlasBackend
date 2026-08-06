---
title: "schema-management"
type: "domain"
status: "verified"
owner: "@PabloArauzCaballero"
criticality: "medium"
last_reviewed: "2026-08-06"
source_revision: "670e9b2"
domain: "schema-management"
module: "SchemaManagementModule"
tags:
  - "backend"
  - "domain"
  - "module/schema-management"
source_files:
  - "src/modules/schema-management/schema-management.module.ts"
  - "src/modules/schema-management/schema-management.controller.ts"
endpoints:
  - "GET /operations/schema/versions"
  - "GET /operations/schema/versions/:versionId"
  - "GET /operations/schema/tables"
  - "GET /operations/schema/tables/:tableId"
  - "POST /operations/schema/tables"
  - "GET /operations/schema/change-log"
  - "PATCH /operations/schema/change-log/:changeId/approve"
dependencies: []
---
# Módulo `schema-management`

Esta pieza gobierna propuestas de estructura sin permitir DDL directo desde el portal.

**Papel técnico:** valida y audita el catálogo de cambios; la ejecución física permanece en migraciones revisadas.

| | |
|---|---|
| Clase | `SchemaManagementModule` |
| Archivos | 7 |
| Controllers | 1 |
| Rutas HTTP | 7 |
| Modelos usados | 0 |
| Esquemas de datos | — |

## Entradas

7 rutas HTTP. Contrato completo en [[04-api/rest/schema-management\|schema-management]].

| Método | Ruta | Auth | Roles |
|---|---|---|---|
| `GET` | `/operations/schema/versions` | 🔒 | `internal_operator` `admin` `platform_admin` `risk_analyst` |
| `GET` | `/operations/schema/versions/:versionId` | 🔒 | `internal_operator` `admin` `platform_admin` `risk_analyst` |
| `GET` | `/operations/schema/tables` | 🔒 | `internal_operator` `admin` `platform_admin` `risk_analyst` |
| `GET` | `/operations/schema/tables/:tableId` | 🔒 | `internal_operator` `admin` `platform_admin` `risk_analyst` |
| `POST` | `/operations/schema/tables` | 🔒 | `internal_operator` `admin` `platform_admin` |
| `GET` | `/operations/schema/change-log` | 🔒 | `internal_operator` `admin` `platform_admin` `risk_analyst` |
| `PATCH` | `/operations/schema/change-log/:changeId/approve` | 🔒 | `platform_admin` |

## Salidas y efectos

`INFERIDO` — no registra modelos propios; opera sobre datos de otros módulos o sobre infraestructura.

## Dependencias

**Depende de:** ningún otro módulo de negocio — es un módulo hoja.

**Del que dependen:** ningún módulo de negocio lo importa.

**Exporta:** `SchemaManagementService`

## Estructura interna

| Capa | Archivos |
|---|---|
| Controllers | `schema-management.controller.ts` |
| Services | `services/schema-management-validation.service.ts`, `services/schema-management.service.ts` |
| Repositories | `schema-management.repository.ts` |
| Esquemas Zod | `schema-management.schemas.ts` |
| Mappers | — |

## Autorización

Roles que alcanzan este módulo: `internal_operator`, `admin`, `platform_admin`, `risk_analyst`, `readonly_auditor`.


## Pruebas

5 archivo(s) de test:

- `test/unit/schema-management/schema-management-validation.service.spec.ts`
- `test/unit/schema-management/schema-management.controller.spec.ts`
- `test/unit/schema-management/schema-management.repository.spec.ts`
- `test/unit/schema-management/schema-management.schemas.spec.ts`
- `test/unit/schema-management/schema-management.service.spec.ts`

## Referencias al código

- Módulo: [`src/modules/schema-management/schema-management.module.ts`](../../../../src/modules/schema-management/schema-management.module.ts)
- Controller `SchemaManagementController`: [`src/modules/schema-management/schema-management.controller.ts`](../../../../src/modules/schema-management/schema-management.controller.ts)

## Relaciones

- [[03-domains/index]] · [[02-architecture/dependency-map]] · [[13-change-impact/dependency-impact-map]]
