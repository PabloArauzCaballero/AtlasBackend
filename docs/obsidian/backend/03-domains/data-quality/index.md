---
title: "data-quality"
type: "domain"
status: "verified"
owner: "unknown"
criticality: "medium"
last_reviewed: "2026-08-06"
source_revision: "670e9b2"
domain: "data-quality"
module: "DataQualityModule"
tags:
  - "backend"
  - "domain"
  - "module/data-quality"
source_files:
  - "src/modules/data-quality/data-quality.module.ts"
  - "src/modules/data-quality/data-quality.controller.ts"
endpoints:
  - "GET /operations/data-quality/issues"
  - "POST /operations/data-quality/issues/:issueId/resolve"
dependencies: []
---
# Módulo `data-quality`

Esta pieza evita decisiones crediticias basadas en datos incompletos, incoherentes o sin linaje.

**Papel técnico:** administra reglas, ejecuciones y hallazgos de calidad consultables por operaciones.

| | |
|---|---|
| Clase | `DataQualityModule` |
| Archivos | 5 |
| Controllers | 1 |
| Rutas HTTP | 2 |
| Modelos usados | 4 |
| Esquemas de datos | [[audit-schema\|audit]] |

## Entradas

2 rutas HTTP. Contrato completo en [[04-api/rest/data-quality\|data-quality]].

| Método | Ruta | Auth | Roles |
|---|---|---|---|
| `GET` | `/operations/data-quality/issues` | 🔒 | `internal_operator` `risk_analyst` `compliance_analyst` `admin` |
| `POST` | `/operations/data-quality/issues/:issueId/resolve` | 🔒 | `internal_operator` `risk_analyst` `compliance_analyst` `admin` |

## Salidas y efectos

Persiste en 4 tabla(s):

- [[data_change_logs]] (`audit`)
- [[data_quality_issues]] (`audit`)
- [[data_quality_rules]] (`audit`)
- [[operational_audit_logs]] (`audit`)

## Dependencias

**Depende de:** ningún otro módulo de negocio — es un módulo hoja.

**Del que dependen:** ningún módulo de negocio lo importa.

**Exporta:** nada — su capacidad no es accesible desde otros módulos.

## Estructura interna

| Capa | Archivos |
|---|---|
| Controllers | `data-quality.controller.ts` |
| Services | `data-quality.service.ts` |
| Repositories | `data-quality.repository.ts` |
| Esquemas Zod | `data-quality.schemas.ts` |
| Mappers | — |

## Autorización

Roles que alcanzan este módulo: `internal_operator`, `risk_analyst`, `compliance_analyst`, `admin`, `platform_admin`.


## Pruebas

3 archivo(s) de test:

- `test/unit/data-quality/data-quality.controller.spec.ts`
- `test/unit/data-quality/data-quality.repository.spec.ts`
- `test/unit/data-quality/data-quality.service.spec.ts`

## Referencias al código

- Módulo: [`src/modules/data-quality/data-quality.module.ts`](../../../../src/modules/data-quality/data-quality.module.ts)
- Controller `DataQualityController`: [`src/modules/data-quality/data-quality.controller.ts`](../../../../src/modules/data-quality/data-quality.controller.ts)

## Relaciones

- [[03-domains/index]] · [[02-architecture/dependency-map]] · [[13-change-impact/dependency-impact-map]]
