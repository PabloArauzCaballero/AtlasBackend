---
title: "health"
type: "domain"
status: "verified"
owner: "unknown"
criticality: "critical"
last_reviewed: "2026-08-06"
source_revision: "670e9b2"
domain: "health"
module: "HealthModule"
tags:
  - "backend"
  - "domain"
  - "module/health"
source_files:
  - "src/modules/health/health.module.ts"
  - "src/modules/health/health.controller.ts"
endpoints:
  - "GET /health"
  - "GET /health/liveness"
  - "GET /health/readiness"
dependencies: []
---
# Módulo `health`

Esta pieza permite retirar instancias enfermas antes de afectar a clientes u operadores.

**Papel técnico:** expone liveness y readiness con estados HTTP útiles para orquestadores.

| | |
|---|---|
| Clase | `HealthModule` |
| Archivos | 2 |
| Controllers | 1 |
| Rutas HTTP | 3 (**3 públicas**) |
| Modelos usados | 0 |
| Esquemas de datos | — |

## Entradas

3 rutas HTTP. Contrato completo en [[04-api/rest/health\|health]].

| Método | Ruta | Auth | Roles |
|---|---|---|---|
| `GET` | `/health` | 🔓 | — |
| `GET` | `/health/liveness` | 🔓 | — |
| `GET` | `/health/readiness` | 🔓 | — |

## Salidas y efectos

`INFERIDO` — no registra modelos propios; opera sobre datos de otros módulos o sobre infraestructura.

## Dependencias

**Depende de:** ningún otro módulo de negocio — es un módulo hoja.

**Del que dependen:** ningún módulo de negocio lo importa.

**Exporta:** nada — su capacidad no es accesible desde otros módulos.

## Estructura interna

| Capa | Archivos |
|---|---|
| Controllers | `health.controller.ts` |
| Services | — |
| Repositories | — |
| Esquemas Zod | — |
| Mappers | — |

## Autorización

Sin rutas HTTP: no aplica autorización de transporte.

> [!danger] Superficie pública
> 3 ruta(s) sin JWT: `GET /health`, `GET /health/liveness`, `GET /health/readiness`.

## Pruebas

3 archivo(s) de test:

- `test/unit/health/health.controller.spec.ts`
- `test/unit/systems-ops/systems-health-monitor.service.spec.ts`
- `test/unit/systems-ops/systems-health.service.spec.ts`

## Referencias al código

- Módulo: [`src/modules/health/health.module.ts`](../../../../src/modules/health/health.module.ts)
- Controller `HealthController`: [`src/modules/health/health.controller.ts`](../../../../src/modules/health/health.controller.ts)

## Relaciones

- [[03-domains/index]] · [[02-architecture/dependency-map]] · [[13-change-impact/dependency-impact-map]]
