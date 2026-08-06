---
title: "Mapa del repositorio"
type: "overview"
status: "verified"
owner: "unknown"
criticality: "medium"
last_reviewed: "2026-08-06"
source_revision: "80fc741"
tags:
  - backend
  - overview
  - repository
aliases: []
related: []
---

# Mapa del repositorio

686 archivos TypeScript en `src/`. Este es el mapa de dónde vive cada cosa.

## Raíz

| Ruta | Contenido |
|---|---|
| `src/` | Código de aplicación |
| `test/` | 304 archivos de test (`test/unit`, `test/e2e`) |
| `scripts/` | Utilidades operativas, gates y 19 smokes |
| `docs/` | Documentación en Markdown + contrato OpenAPI + esta bóveda |
| `config/`, `ops/` | Configuración de infraestructura y operación |
| `asyncapi/`, `structurizr/` | Contratos de eventos y modelo de arquitectura |
| `.claude/` | Reglas y skills para agentes de ingeniería |
| `.github/workflows/ci.yml` | Integración continua |

## `src/` — organización

```text
src/
├── main.ts                    Entrypoint de la API
├── worker.ts                  Entrypoint del worker
├── app.module.ts              Composición raíz: 28 módulos + filtros/interceptores globales
├── config/                    Configuración tipada (Zod) y setup de OpenAPI
├── common/                    Infraestructura transversal, sin reglas de dominio
├── database/                  Modelos, migraciones, seeders, esquemas de dominio
├── modules/                   28 módulos de negocio
├── observability/             Bootstrap y apagado de OpenTelemetry
└── worker/                    Sonda HTTP del proceso worker
```

## `src/common/` — lo transversal

Regla del proyecto: aquí **no** viven reglas de un dominio concreto.

| Carpeta | Responsabilidad |
|---|---|
| `guards/` | `JwtAuthGuard`, `RolesGuard`, `TenantGuard` |
| `interceptors/` | Envoltura de respuesta, timeout de request, log de acciones HTTP |
| `filters/` | `HttpExceptionFilter` — modelo de error único |
| `pipes/` | `ZodValidationPipe` |
| `middleware/` | `CorrelationIdMiddleware` |
| `decorators/` | `@Public`, `@Roles`, `@CurrentUser` |
| `observability/` | Métricas Prometheus, métricas del pool de BD |
| `resilience/` | Circuit breaker, reintentos, ejecutor resiliente de adaptadores |
| `redis/`, `storage/`, `logging/`, `lifecycle/` | Cliente Redis, S3 + antimalware, logger a archivo, apagado con drenado |
| `utils/crypto/` | Envelope encryption y proveedor KMS |
| `types/` | Contratos internos, incluido el vocabulario de roles |

## `src/database/`

| Carpeta | Contenido |
|---|---|
| `models/` | 130 modelos Sequelize, uno por tabla |
| `migrations/` | 61 migraciones Umzug |
| `migration-support/` | `atlas-schema-builder.util.ts` — helpers idempotentes de FK/CHECK/índice |
| `seeders/` | 18 seeders con perfiles (`production`, `development`, `demo`, `test`) |
| `seed-data/`, `context-seed/` | Datos maestros y carga de contexto multidominio |
| `domain-schemas.ts` | **Fuente única** del mapa tabla → esquema físico |

## `src/modules/` — los 28 módulos

| Grupo | Módulos |
|---|---|
| Identidad | `auth`, `internal-users`, `sessions` |
| Cliente | `customers`, `customer-onboarding`, `customer-privacy`, `customer-telemetry`, `consents` |
| Decisión | `risk`, `fraud`, `credit`, `external-data` |
| Datos | `catalog-management`, `data-quality`, `schema-management` |
| Comunicación | `notifications`, `mail-sender` |
| Plataforma | `events`, `runtime-jobs`, `runtime-hardening`, `operations`, `systems-ops`, `internal-portal`, `workflow-catalog`, `audit`, `log-sync`, `health` |

Cada módulo sigue el mismo esqueleto: `*.module.ts`, `*.controller.ts`, `*.service.ts`, `*.repository.ts`, `*.schemas.ts` (Zod), `*.mapper.ts`. Los módulos grandes se subdividen (`external-data/` usa `domain/`, `application/`, `infrastructure/`).

## `scripts/`

| Grupo | Ejemplos |
|---|---|
| Gates de calidad | `check-file-size.ts`, `check-migrations.ts`, `check-overfetching.ts`, `check-tenant-header-usage.ts`, `check-domain-schemas.ts`, `check-openapi-contract.ts` |
| Smokes | `scripts/smoke/*.smoke.ts` — 19 guiones contra un backend levantado |
| Operación de datos | `bootstrap-db-roles.ts`, `check-db-privileges.ts`, `capture-query-baseline.ts`, `reencrypt-pii-to-envelope.ts` |
| Desarrollo | `create-dev-jwt.ts`, `hash-password.ts`, `env-doctor.ts` |

> [!info] Los gates son trinquetes con línea base
> `.file-size-baseline.json` y `.tenant-header-baseline.json` congelan el estado actual: los gates no exigen perfección inmediata, exigen **no empeorar**. Un archivo ya grande no puede crecer y uno nuevo no puede nacer grande.

## Artefactos generados (no versionados)

`dist/`, `coverage/`, `node_modules/`, `graphify-out/`, `Archivo.log`.

## Relaciones

- [[01-overview/technology-stack]] · [[12-development/coding-conventions]] · [[03-domains/index]]
