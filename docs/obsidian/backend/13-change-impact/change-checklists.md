---
title: "Listas de verificación de cambios"
type: "runbook"
status: "verified"
owner: "unknown"
criticality: "high"
last_reviewed: "2026-08-06"
source_revision: "80fc741"
tags:
  - backend
  - change-impact
aliases: []
related: []
---
# Listas de verificación de cambios

## Endpoint nuevo

- [ ] Esquema Zod en el `*.schemas.ts` del módulo
- [ ] `ZodValidationPipe` en body, params y query
- [ ] `@Roles(...)` explícito — **sin él, cualquier autenticado pasa**
- [ ] Decidir si exige `x-idempotency-key` (comandos)
- [ ] Decidir si exige `x-tenant-id`
- [ ] Decoradores `@Api*` para el contrato
- [ ] Si es público: `@Public()` **y** `@Throttle` estricto
- [ ] Si es por `customerId`: ownership anti-BOLA
- [ ] Test e2e
- [ ] `yarn check:openapi`

## Tabla nueva

- [ ] Registrarla en `ATLAS_DOMAIN_TABLES` (si no, `atlasSchemaFor` lanza)
- [ ] Migración de creación + migración de relaciones
- [ ] `_id`, `_tenant_id`, `_created_at`, `_updated_at`, `_deleted`
- [ ] Índice por `_tenant_id` (parcial si hay borrado lógico)
- [ ] **Índice en las columnas FK** — ver [[14-audits/risks-register\|PERF-001]]
- [ ] Modelo con `declare` y `timestamps: false`
- [ ] Ids `BIGINT` como `string` en TypeScript
- [ ] Clasificar los campos sensibles; aplicar hash + cifrado + fragmento si procede
- [ ] Probar `up → down → up`
- [ ] `yarn check:domain-schemas` y `check:migrations`

## Cambio de columna

- [ ] ¿Compatible con el código **viejo**? Las migraciones corren antes
- [ ] Patrón en dos fases si va a ser `NOT NULL`
- [ ] Revisar vistas `read_api` que la usen
- [ ] Revisar mappers y DTO
- [ ] `yarn check:openapi` si sale al contrato

## Job nuevo

- [ ] Entrada en `scheduled-jobs.catalog.ts` — **y en ningún otro sitio**
- [ ] Variable de intervalo en el esquema de entorno
- [ ] Pasar `dryRun: false` explícito
- [ ] ¿Es idempotente? Puede reejecutarse
- [ ] Registro en `system_job_runs`
- [ ] ¿Necesita ventana horaria? Ver [[14-audits/risks-register\|OPS-001]]

## Integración externa nueva

- [ ] Implementar `ExternalProviderAdapter`
- [ ] Envolver con `ResilientAdapterExecutorService`
- [ ] Timeouts, reintentos y circuit breaker configurados
- [ ] Atar `consent_id` a la consulta
- [ ] Política de coste y de retención
- [ ] Registro en `provider_health_logs`
- [ ] Mock + smoke de camino feliz y de error

## Variable de entorno nueva

- [ ] Esquema Zod con default seguro
- [ ] Validación cruzada si depende de otra
- [ ] Añadir a `.env.example`
- [ ] Documentar en [[15-reference/environment-variables]]
- [ ] `yarn check:env-example`

## Rol nuevo

- [ ] Añadir **solo** a `ATLAS_USER_ROLES` — todo lo demás se deriva
- [ ] Decidir el `legacyRoleCode` si es un rol interno
- [ ] Revisar qué rutas debe alcanzar
- [ ] `smoke:internal-rbac`

## Siempre

```bash
yarn type-check && yarn type-check:tests && yarn lint && yarn format:check && yarn test
```

## Relaciones

- [[11-quality/quality-gates]] · [[13-change-impact/high-risk-components]] · [[12-development/coding-conventions]]
