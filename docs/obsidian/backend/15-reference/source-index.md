---
title: "Índice de fuentes"
type: "reference"
status: "verified"
owner: "unknown"
criticality: "low"
last_reviewed: "2026-08-06"
source_revision: "80fc741"
tags:
  - backend
  - reference
aliases: []
related: []
---
# Índice de fuentes

Dónde vive cada cosa en el código.

## Puntos de entrada

| Qué | Ruta |
|---|---|
| API | `src/main.ts` |
| Worker | `src/worker.ts` |
| Composición raíz | `src/app.module.ts` |
| Migraciones | `src/database/migrate.ts` |
| Seeds | `src/database/seed.ts` |

## Fuentes únicas de verdad

| Concepto | Ruta |
|---|---|
| Vocabulario de roles | `src/common/types/auth.types.ts` |
| Mapa tabla → esquema | `src/database/domain-schemas.ts` |
| Catálogo de jobs | `src/modules/runtime-jobs/scheduled-jobs.catalog.ts` |
| Registro de eventos | `src/modules/events/event-registry.ts` |
| Esquema de entorno | `src/config/env.schema.ts` (+ `env.database`, `env.runtime-jobs`) |
| Validaciones cruzadas de entorno | `src/config/env-cross-checks.ts` |
| Roles internos | `src/modules/internal-users/internal-rbac.roles.ts` |
| Helpers de esquema | `src/database/migration-support/atlas-schema-builder.util.ts` |

## Transversales

| Qué | Ruta |
|---|---|
| Guards | `src/common/guards/` |
| Interceptores | `src/common/interceptors/` |
| Filtro de errores | `src/common/filters/http-exception.filter.ts` |
| Validación | `src/common/pipes/zod-validation.pipe.ts` |
| Correlación | `src/common/middleware/correlation-id.middleware.ts` |
| Resiliencia | `src/common/resilience/` |
| Cifrado | `src/common/utils/crypto/` |
| Observabilidad | `src/common/observability/` · `src/observability/` |
| Ciclo de vida | `src/common/lifecycle/` |

## Documentación relacionada (fuera de la bóveda)

| Qué | Ruta |
|---|---|
| ADR canónicos | `docs/adr/` |
| Contrato OpenAPI | `docs/endpoints/openapi.yaml` |
| Roles PostgreSQL | `docs/database/postgres-roles.md` |
| Mapeo de errores SQL | `docs/database/postgres-error-mapping.md` |
| Credenciales de desarrollo | `docs/database/dev-credentials.md` |
| Trinquete de cobertura | `docs/testing/coverage-ratchet.md` |
| Matriz de proveedores externos | `docs/testing/external-providers-test-matrix.md` |
| Auditorías previas | `docs/audit/` |
| Reglas para agentes | `.claude/rules/` |

## Relaciones

- [[01-overview/repository-map]] · [[_meta/source-inventory]]
