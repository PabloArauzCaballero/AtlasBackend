---
title: "Migraciones"
type: "data"
status: "verified"
owner: "@PabloArauzCaballero"
criticality: "critical"
last_reviewed: "2026-08-06"
source_revision: "80fc741"
tags:
  - "backend"
  - "data"
  - "migrations"
source_files:
  - "src/database/migrate.ts"
  - "src/database/migration-support/atlas-schema-builder.util.ts"
---
# Migraciones

**61 migraciones** ejecutadas con **Umzug** (`src/database/migrate.ts`). 61 declaran `down`.

## Comandos

| Acción | Comando |
|---|---|
| Aplicar | `yarn db:migration:up` |
| Revertir la última | `yarn db:migration:down` |
| Estado | `yarn db:migration:status` |
| Crear una nueva | `yarn db:migration:create` |
| Gate de validación | `yarn check:migrations` |

## Estrategia: tablas primero, relaciones después

> [!info] Verificado
> Las 10 migraciones `schema-part-N-*` crean **todas** las tablas de un dominio; las 10 `schema-relationships-part-N-*` añaden después FK, CHECK e índices. La separación es deliberada: al correr las relaciones cuando todas las tablas ya existen, una FK puede apuntar a cualquier dominio **sin depender del orden**. Justificación completa en `docs/architecture/migration-split-verification.md`.

## Idempotencia

Los helpers de `atlas-schema-builder.util.ts` comprueban existencia antes de actuar: `constraintExists()` antes de cada FK/CHECK, e `IF NOT EXISTS` en cada índice. Re-ejecutar una migración sobre un esquema ya migrado no falla.

## Listado

| # | Migración | Reversible | Propósito |
|---:|---|---|---|
| 1 | `20260626154044-schema-part-0-platform-core.ts` | Sí | @file Migración reversible: evoluciona el esquema PostgreSQL en orden. @business Esta pieza preserva la fuente de verdad y la evidencia histórica que soportan d |
| 2 | `20260626154045-schema-part-1-customers-identity.ts` | Sí | @file Migración reversible: evoluciona el esquema PostgreSQL en orden. @business Esta pieza preserva la fuente de verdad y la evidencia histórica que soportan d |
| 3 | `20260626154046-schema-part-2-privacy-consents.ts` | Sí | @file Migración reversible: evoluciona el esquema PostgreSQL en orden. @business Esta pieza preserva la fuente de verdad y la evidencia histórica que soportan d |
| 4 | `20260626154047-schema-part-3-devices-sessions.ts` | Sí | @file Migración reversible: evoluciona el esquema PostgreSQL en orden. @business Esta pieza preserva la fuente de verdad y la evidencia histórica que soportan d |
| 5 | `20260626154048-schema-part-4-onboarding-behavior.ts` | Sí | @file Migración reversible: evoluciona el esquema PostgreSQL en orden. @business Esta pieza preserva la fuente de verdad y la evidencia histórica que soportan d |
| 6 | `20260626154049-schema-part-5-catalog-context.ts` | Sí | @file Migración reversible: evoluciona el esquema PostgreSQL en orden. @business Esta pieza preserva la fuente de verdad y la evidencia histórica que soportan d |
| 7 | `20260626154050-schema-part-6-features-scoring.ts` | Sí | @file Migración reversible: evoluciona el esquema PostgreSQL en orden. @business Esta pieza preserva la fuente de verdad y la evidencia histórica que soportan d |
| 8 | `20260626154051-schema-part-7-risk-engine.ts` | Sí | @file Migración reversible: evoluciona el esquema PostgreSQL en orden. @business Esta pieza preserva la fuente de verdad y la evidencia histórica que soportan d |
| 9 | `20260626154052-schema-part-8-fraud-review.ts` | Sí | @file Migración reversible: evoluciona el esquema PostgreSQL en orden. @business Esta pieza preserva la fuente de verdad y la evidencia histórica que soportan d |
| 10 | `20260626154053-schema-part-9-audit-quality.ts` | Sí | @file Migración reversible: evoluciona el esquema PostgreSQL en orden. @business Esta pieza preserva la fuente de verdad y la evidencia histórica que soportan d |
| 11 | `20260626154054-schema-relationships-part-0-platform-core.ts` | Sí | @file Migración reversible: evoluciona el esquema PostgreSQL en orden. @business Esta pieza preserva la fuente de verdad y la evidencia histórica que soportan d |
| 12 | `20260626154055-schema-relationships-part-1-customers-identity.ts` | Sí | @file Migración reversible: evoluciona el esquema PostgreSQL en orden. @business Esta pieza preserva la fuente de verdad y la evidencia histórica que soportan d |
| 13 | `20260626154056-schema-relationships-part-2-privacy-consents.ts` | Sí | @file Migración reversible: evoluciona el esquema PostgreSQL en orden. @business Esta pieza preserva la fuente de verdad y la evidencia histórica que soportan d |
| 14 | `20260626154057-schema-relationships-part-3-devices-sessions.ts` | Sí | @file Migración reversible: evoluciona el esquema PostgreSQL en orden. @business Esta pieza preserva la fuente de verdad y la evidencia histórica que soportan d |
| 15 | `20260626154058-schema-relationships-part-4-onboarding-behavior.ts` | Sí | @file Migración reversible: evoluciona el esquema PostgreSQL en orden. @business Esta pieza preserva la fuente de verdad y la evidencia histórica que soportan d |
| 16 | `20260626154059-schema-relationships-part-5-catalog-context.ts` | Sí | @file Migración reversible: evoluciona el esquema PostgreSQL en orden. @business Esta pieza preserva la fuente de verdad y la evidencia histórica que soportan d |
| 17 | `20260626154100-schema-relationships-part-6-features-scoring.ts` | Sí | @file Migración reversible: evoluciona el esquema PostgreSQL en orden. @business Esta pieza preserva la fuente de verdad y la evidencia histórica que soportan d |
| 18 | `20260626154101-schema-relationships-part-7-risk-engine.ts` | Sí | @file Migración reversible: evoluciona el esquema PostgreSQL en orden. @business Esta pieza preserva la fuente de verdad y la evidencia histórica que soportan d |
| 19 | `20260626154102-schema-relationships-part-8-fraud-review.ts` | Sí | @file Migración reversible: evoluciona el esquema PostgreSQL en orden. @business Esta pieza preserva la fuente de verdad y la evidencia histórica que soportan d |
| 20 | `20260626154103-schema-relationships-part-9-audit-quality.ts` | Sí | @file Migración reversible: evoluciona el esquema PostgreSQL en orden. @business Esta pieza preserva la fuente de verdad y la evidencia histórica que soportan d |
| 21 | `20260629170000-add-runtime-hardening-tables.ts` | Sí | @file Migración reversible: evoluciona el esquema PostgreSQL en orden. @business Esta pieza preserva la fuente de verdad y la evidencia histórica que soportan d |
| 22 | `20260630183000-patch-2-event-messaging-core.ts` | Sí | @file Migración reversible: evoluciona el esquema PostgreSQL en orden. @business Esta pieza preserva la fuente de verdad y la evidencia histórica que soportan d |
| 23 | `20260630193000-patch-2-real-notification-adapters.ts` | Sí | @file Migración reversible: evoluciona el esquema PostgreSQL en orden. @business Esta pieza preserva la fuente de verdad y la evidencia histórica que soportan d |
| 24 | `20260701000000-add-auth-credentials-and-email-uniqueness.ts` | Sí | @file Migración reversible: evoluciona el esquema PostgreSQL en orden. @business Esta pieza preserva la fuente de verdad y la evidencia histórica que soportan d |
| 25 | `20260702031000-add-external-data-provider-orchestration.ts` | Sí | @file Migración reversible: evoluciona el esquema PostgreSQL en orden. @business Esta pieza preserva la fuente de verdad y la evidencia histórica que soportan d |
| 26 | `20260702040000-add-external-provider-resilience-v4.ts` | Sí | @file Migración reversible: evoluciona el esquema PostgreSQL en orden. @business Esta pieza preserva la fuente de verdad y la evidencia histórica que soportan d |
| 27 | `20260702043000-hardening-external-providers-v6.ts` | Sí | @file Migración reversible: evoluciona el esquema PostgreSQL en orden. @business Esta pieza preserva la fuente de verdad y la evidencia histórica que soportan d |
| 28 | `20260703001000-add-systems-ops-catalog-qa-audit.ts` | Sí | @file Migración reversible: evoluciona el esquema PostgreSQL en orden. @business Esta pieza preserva la fuente de verdad y la evidencia histórica que soportan d |
| 29 | `20260703011000-add-systems-ops-phase2-review-stress.ts` | Sí | @file Migración reversible: evoluciona el esquema PostgreSQL en orden. @business Esta pieza preserva la fuente de verdad y la evidencia histórica que soportan d |
| 30 | `20260703035812-add-unified-audit-event-feed-view.ts` | Sí | @file Migración reversible: evoluciona el esquema PostgreSQL en orden. @business Esta pieza preserva la fuente de verdad y la evidencia histórica que soportan d |
| 31 | `20260704120000-add-internal-rbac-module.ts` | Sí | @file Migración reversible: evoluciona el esquema PostgreSQL en orden. @business Esta pieza preserva la fuente de verdad y la evidencia histórica que soportan d |
| 32 | `20260705113000-add-systems-business-metadata-governance.ts` | Sí | @file Migración reversible: evoluciona el esquema PostgreSQL en orden. @business Esta pieza preserva la fuente de verdad y la evidencia histórica que soportan d |
| 33 | `20260705113000-add-systems-ops-rich-metadata-tables.ts` | Sí | @file Migración reversible: evoluciona el esquema PostgreSQL en orden. @business Esta pieza preserva la fuente de verdad y la evidencia histórica que soportan d |
| 34 | `20260705113500-extend-endpoint-data-entity-impacts.ts` | Sí | @file Migración reversible: evoluciona el esquema PostgreSQL en orden. @business Esta pieza preserva la fuente de verdad y la evidencia histórica que soportan d |
| 35 | `20260706030000-phase-4a-create-schema-versions.ts` | Sí | @file Migración reversible: evoluciona el esquema PostgreSQL en orden. @business Esta pieza preserva la fuente de verdad y la evidencia histórica que soportan d |
| 36 | `20260706040000-phase-4a-create-schema-tables.ts` | Sí | @file Migración reversible: evoluciona el esquema PostgreSQL en orden. @business Esta pieza preserva la fuente de verdad y la evidencia histórica que soportan d |
| 37 | `20260706050000-phase-4a-create-schema-columns.ts` | Sí | @file Migración reversible: evoluciona el esquema PostgreSQL en orden. @business Esta pieza preserva la fuente de verdad y la evidencia histórica que soportan d |
| 38 | `20260706060000-phase-4a-create-schema-relationships.ts` | Sí | @file Migración reversible: evoluciona el esquema PostgreSQL en orden. @business Esta pieza preserva la fuente de verdad y la evidencia histórica que soportan d |
| 39 | `20260706070000-phase-4a-create-schema-change-log.ts` | Sí | @file Migración reversible: evoluciona el esquema PostgreSQL en orden. @business Esta pieza preserva la fuente de verdad y la evidencia histórica que soportan d |
| 40 | `20260706090000-create-catalog-entries.ts` | Sí | @file Migración reversible: evoluciona el esquema PostgreSQL en orden. @business Esta pieza preserva la fuente de verdad y la evidencia histórica que soportan d |
| 41 | `20260706110000-phase-4b-add-approval-notes-to-schema-change-log.ts` | Sí | @file Migración reversible: evoluciona el esquema PostgreSQL en orden. @business Esta pieza preserva la fuente de verdad y la evidencia histórica que soportan d |
| 42 | `20260706120000-widen-system-data-relationship-optionality.ts` | Sí | @file Migración reversible: evoluciona el esquema PostgreSQL en orden. @business Esta pieza preserva la fuente de verdad y la evidencia histórica que soportan d |
| 43 | `20260707120000-add-systems-data-column-catalog-runtime.ts` | Sí | @file Migración reversible: evoluciona el esquema PostgreSQL en orden. @business Esta pieza preserva la fuente de verdad y la evidencia histórica que soportan d |
| 44 | `20260709090000-add-is-worker-to-system-tool-catalog.ts` | Sí | @file Migración reversible: evoluciona el esquema PostgreSQL en orden. @business Esta pieza preserva la fuente de verdad y la evidencia histórica que soportan d |
| 45 | `20260710090000-add-owner-domain-to-definitions.ts` | Sí | @file Migración reversible: evoluciona el esquema PostgreSQL en orden. @business Esta pieza preserva la fuente de verdad y la evidencia histórica que soportan d |
| 46 | `20260711100000-add-tenant-scope-to-systems-ops-runtime.ts` | Sí | @file Migración reversible: evoluciona el esquema PostgreSQL en orden. @business Esta pieza preserva la fuente de verdad y la evidencia histórica que soportan d |
| 47 | `20260711101000-create-system-catalog-review-events.ts` | Sí | @file Migración reversible: evoluciona el esquema PostgreSQL en orden. @business Esta pieza preserva la fuente de verdad y la evidencia histórica que soportan d |
| 48 | `20260711120000-add-covering-index-system-action-logs-traffic.ts` | Sí | @file Migración reversible: evoluciona el esquema PostgreSQL en orden. @business Esta pieza preserva la fuente de verdad y la evidencia histórica que soportan d |
| 49 | `20260711130000-add-notification-category-icon.ts` | Sí | @file Migración reversible: evoluciona el esquema PostgreSQL en orden. @business Esta pieza preserva la fuente de verdad y la evidencia histórica que soportan d |
| 50 | `20260713000000-add-context-catalog-natural-key-indexes.ts` | Sí | @file Migración reversible: evoluciona el esquema PostgreSQL en orden. @business Esta pieza preserva la fuente de verdad y la evidencia histórica que soportan d |
| 51 | `20260713100000-add-backend-service-to-system-endpoint-catalog.ts` | Sí | @file Migración reversible: evoluciona el esquema PostgreSQL en orden. @business Esta pieza preserva la fuente de verdad y la evidencia histórica que soportan d |
| 52 | `20260713120000-add-context-seed-governance-and-checkpoints.ts` | Sí | @file Migración reversible: evoluciona el esquema PostgreSQL en orden. @business Esta pieza preserva la fuente de verdad y la evidencia histórica que soportan d |
| 53 | `20260714000000-add-auth-one-time-codes.ts` | Sí | @file Migración reversible: evoluciona el esquema PostgreSQL en orden. @business Esta pieza preserva la fuente de verdad y la evidencia histórica que soportan d |
| 54 | `20260715120000-create-read-api-schema-and-views-v1.ts` | Sí | @file Migración reversible: evoluciona el esquema PostgreSQL en orden. @business Esta pieza preserva la fuente de verdad y la evidencia histórica que soportan d |
| 55 | `20260717000000-add-customer-mfa-to-auth-credentials.ts` | Sí | @file Migración reversible: evoluciona el esquema PostgreSQL en orden. @business Esta pieza preserva la fuente de verdad y la evidencia histórica que soportan d |
| 56 | `20260717120000-split-write-model-into-domain-schemas.ts` | Sí | @file Migración reversible: evoluciona el esquema PostgreSQL en orden. @business Esta pieza preserva la fuente de verdad y la evidencia histórica que soportan d |
| 57 | `20260721120000-harden-deleted-flag-not-null.ts` | Sí | @file Migración reversible: evoluciona el esquema PostgreSQL en orden. @business Esta pieza preserva la fuente de verdad y la evidencia histórica que soportan d |
| 58 | `20260727120000-add-entity-business-narrative-columns.ts` | Sí | @file Migración reversible: evoluciona el esquema PostgreSQL en orden. @business Esta pieza preserva la fuente de verdad y la evidencia histórica que soportan d |
| 59 | `20260728090000-add-customer-lifecycle-state-machine-and-eligibility.ts` | Sí | @file Migración reversible: evoluciona el esquema PostgreSQL en orden. @business Esta pieza preserva la fuente de verdad y la evidencia histórica que soportan d |
| 60 | `20260728120000-create-credit-products-and-applications.ts` | Sí | @file Migración reversible: evoluciona el esquema PostgreSQL en orden. @business Esta pieza preserva la fuente de verdad y la evidencia histórica que soportan d |
| 61 | `20260728140000-create-workflow-catalog.ts` | Sí | @file Migración reversible: evoluciona el esquema PostgreSQL en orden. @business Esta pieza preserva la fuente de verdad y la evidencia histórica que soportan d |

## Relaciones

- [[05-data/physical-data-model]] · [[10-operations/deployment]] · [[13-change-impact/change-checklists]]
