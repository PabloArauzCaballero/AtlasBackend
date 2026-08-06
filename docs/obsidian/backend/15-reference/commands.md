---
title: "Comandos"
type: "reference"
status: "verified"
owner: "unknown"
criticality: "medium"
last_reviewed: "2026-08-06"
source_revision: "80fc741"
tags:
  - backend
  - reference
aliases: []
related: []
---
# Comandos

Todos verificados contra `package.json` en la revisión 80fc741.

## Desarrollo

| Comando | Qué hace |
|---|---|
| `yarn start:dev` | Compila y arranca forzando `NODE_ENV=development` |
| `yarn start:dev:tsx` | `tsx watch` sobre `src/main.ts` |
| `yarn start:prod` | Compila y arranca con configuración de producción |
| `yarn start` | Arranca `dist/src/main.js` tal cual esté el entorno |
| `yarn build` | Compila a `dist/` |

## Calidad

| Comando | Qué hace |
|---|---|
| `yarn type-check` / `type-check:tests` | `tsc --noEmit` |
| `yarn lint` / `lint:fix` | ESLint |
| `yarn format` / `format:check` | Prettier |
| `yarn test` / `test:unit` / `test:e2e` | Jest |
| `yarn test:unit:randomized` | Detecta dependencia del orden |
| `yarn test:coverage` | Informe de cobertura |

## Base de datos

| Comando | Qué hace |
|---|---|
| `yarn db:migration:up` / `down` / `status` | Migraciones |
| `yarn db:migration:create` | Nueva migración |
| `yarn db:seed:up` / `down` / `status` / `reseed` | Seeds |
| `yarn db:seed:prod` / `dev` / `demo` / `test` | Seeds por perfil |
| `yarn db:roles:bootstrap` | Aprovisiona los roles PostgreSQL |
| `yarn db:provision:dev` | Roles + verificación de privilegios |
| `yarn db:capture-query-baseline` | Captura el baseline de consultas |
| `yarn db:extract-read-workload` | Extrae la carga de lectura |
| `yarn db:context:load` / `validate` | Carga de contexto multidominio |
| `yarn db:seed:verify-graph` | Integridad del grafo de seeds |

## Gates

| Comando | Qué protege |
|---|---|
| `yarn check:file-size` | Tamaño de archivo (trinquete) |
| `yarn check:tenant-header` | Uso de `x-tenant-id` (trinquete) |
| `yarn check:domain-schemas` · `check:domain-schema-layout` | Esquemas de dominio |
| `yarn check:migrations` | Migraciones |
| `yarn check:overfetching` | Sobrelectura |
| `yarn check:read-api-views` | Modelo de lectura |
| `yarn check:entity-narratives` | Narrativa de entidades |
| `yarn check:openapi` | Contrato ↔ código |
| `yarn check:seed-profiles` | Perfiles de seed |
| `yarn check:no-env-file` · `check:env-example` | Entorno y secretos |
| `yarn check:db-privileges` | Privilegios del rol de runtime |

## Smoke y estrés

`yarn smoke` · `smoke:core` · `smoke:auth` · `smoke:sessions` · `smoke:catalog` · `smoke:workflow` · `smoke:runtime` · `smoke:events` · `smoke:notifications` · `smoke:risk-telemetry` · `smoke:internal-rbac` · `smoke:user-types` · `smoke:frontend-contract` · `smoke:external-providers`(`:errors`, `:governance`) · `stress:notifications`

## Documentación

| Comando | Qué hace |
|---|---|
| `yarn docs:openapi` | Genera el contrato |
| `yarn docs:openapi:lint` / `bundle` / `stats` | Redocly |
| `yarn docs:project` / `folders` / `inline` | Documentación del proyecto |
| `yarn docs:serve` / `build` | MkDocs |
| `yarn docs:validate` | Cadena completa de validación documental |

## Utilidades

| Comando | Qué hace |
|---|---|
| `yarn dev:jwt --role=admin` | JWT de desarrollo |
| `yarn hash-password` | Hash argon2 |
| `yarn env:doctor` | Diagnóstico de configuración |
| `yarn crypto:reencrypt-pii` (`:dry-run`) | Migra PII al proveedor KMS |
| `yarn mock:providers` | Levanta el mock de proveedores externos |

## Relaciones

- [[11-quality/quality-gates]] · [[12-development/local-setup]]
