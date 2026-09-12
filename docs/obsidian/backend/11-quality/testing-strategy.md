---
title: "Estrategia de pruebas"
type: "reference"
status: "verified"
owner: "@PabloArauzCaballero"
criticality: "high"
last_reviewed: "2026-08-06"
source_revision: "80fc741"
tags:
  - backend
  - quality
  - testing
source_files:
  - "jest.config.cjs"
aliases: []
related: []
---
# Estrategia de pruebas

## Inventario

| Tipo | Archivos | Ubicación | Comando |
|---|---:|---|---|
| Unitarias | 293 | `test/unit/` | `yarn test:unit` |
| End-to-end | 11 | `test/e2e/` | `yarn test:e2e` |
| Smoke | 19 guiones | `scripts/smoke/` | `yarn smoke:*` |
| Estrés | 1 | `scripts/stress/` | `yarn stress:notifications` |

Total: **304 archivos de test**.

## Qué cubre cada nivel

| Nivel | Qué valida | Necesita backend levantado |
|---|---|---|
| Unitarias | Lógica de servicio, mappers, utilidades, validación Zod | No |
| E2E | Rutas HTTP completas con `supertest` | No (instancia Nest en proceso) |
| Smoke | Un backend **real** respondiendo | **Sí** |
| Estrés | Comportamiento bajo carga | Sí |

> [!info] Los smokes no son tests, son verificación de despliegue
> Corren contra un backend levantado y sirven para responder "¿esto quedó bien desplegado?". Por eso viven en `scripts/` y no en `test/`, y por eso `yarn test` no los ejecuta.

## Smokes disponibles

- `auth.smoke.ts`
- `catalog.smoke.ts`
- `core.smoke.ts`
- `events.smoke.ts`
- `external-providers-errors.smoke.ts`
- `external-providers-governance.smoke.ts`
- `external-providers.smoke.ts`
- `frontend-contract.smoke.ts`
- `http.ts`
- `index.ts`
- `internal-rbac.smoke.ts`
- `notifications.smoke.ts`
- `redact.ts`
- `required-smoke-env.ts`
- `risk-telemetry.smoke.ts`
- `runtime.smoke.ts`
- `sessions.smoke.ts`
- `user-types.smoke.ts`
- `workflow-catalog.smoke.ts`

Comandos: `yarn smoke:core`, `smoke:auth`, `smoke:sessions`, `smoke:catalog`, `smoke:workflow`, `smoke:runtime`, `smoke:events`, `smoke:notifications`, `smoke:risk-telemetry`, `smoke:internal-rbac`, `smoke:user-types`, `smoke:frontend-contract`, `smoke:external-providers`(`:errors`, `:governance`).

## Aleatorización

`yarn test:unit:randomized` ejecuta con `--randomize`: detecta tests que dependen del orden, que es la forma habitual de que una suite verde esconda acoplamiento entre casos.

## Trinquete de cobertura

`docs/testing/coverage-ratchet.md` documenta el mecanismo: la cobertura no puede bajar. Como los gates de tamaño de archivo, exige **no empeorar** en vez de perfección inmediata.

`yarn test:coverage` genera el informe. `PENDIENTE` — no se ejecutó en esta revisión, así que esta bóveda **no** documenta ningún porcentaje.

## Pruebas de contrato

`yarn check:openapi` compara el contrato generado con el versionado: un cambio de forma no declarado hace fallar el gate. Es lo que impide romper clientes sin enterarse.

## Datos de prueba

Perfil `test` de los seeders (`yarn db:seed:test`), separado de `development`, `demo` y `production`. `yarn check:seed-profiles` valida la separación.

## Proveedores externos

Repositorio de mock aparte (`yarn mock:providers`) y matriz en `docs/testing/external-providers-test-matrix.md`. Las pruebas no llaman a proveedores reales.

## Relaciones

- [[11-quality/quality-gates]] · [[11-quality/coverage-gaps]] · [[06-integrations/index]]
