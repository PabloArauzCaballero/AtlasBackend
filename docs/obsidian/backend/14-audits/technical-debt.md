---
title: "Deuda técnica"
type: "audit"
status: "verified"
owner: "unknown"
criticality: "medium"
last_reviewed: "2026-08-06"
source_revision: "80fc741"
tags:
  - backend
  - audit
aliases: []
related: []
---
# Deuda técnica

Deuda **observable en el código**, distinta de los riesgos de [[14-audits/risks-register]]: aquí no hay fallo, hay coste de mantenimiento.

## La deuda está medida y congelada

> [!info] Los ficheros de línea base son el inventario de deuda
> `.file-size-baseline.json` y `.tenant-header-baseline.json` congelan el estado actual para que los gates impidan empeorar. Eso significa que **documentan con precisión qué deuda existe hoy**: cada entrada es un archivo demasiado grande o un uso de cabecera de tenant que no cumple la regla.
>
> Es una forma honesta de gestionar deuda: no se finge que no existe, y no se bloquea el trabajo exigiendo arreglarla de golpe.

## Elementos

| ID | Deuda | Coste | Evidencia |
|---|---|---|---|
| `TD-01` | Archivos por encima del límite de tamaño | Difíciles de revisar y de cambiar sin efectos colaterales | `.file-size-baseline.json` |
| `TD-02` | Cobertura incompleta de la cabecera de tenant | El aislamiento no es uniforme | `.tenant-header-baseline.json` |
| `TD-03` | `platform_ops` con 25 tablas y 4 subdominios | Propiedad difusa; cambios que se pisan | [[platform_ops-schema]] |
| `TD-04` | `CustomersModule` exporta `CustomersRepository` | 12 módulos pueden saltarse las reglas del servicio | [[02-architecture/dependency-map]] |
| `TD-05` | Hexagonalidad solo en `external-data` | No hay un patrón interno único de módulo | [[02-architecture/architectural-style]] |
| `TD-06` | 40 eventos sin dominio persistido | El catálogo promete más de lo que hay | [[14-audits/contradictions]] |
| `TD-07` | `.env.example` con 208 nombres frente a 159 en el esquema | Ambigüedad sobre qué se valida | [[15-reference/environment-variables]] |
| `TD-08` | Scripts `audit:external-providers:*` con múltiples variantes casi idénticas | `v5`, `v6`, `v7`, `quality-10`, `go-live`… conviven en `package.json` sin criterio claro de cuál usar | `package.json` |
| `TD-09` | Sin ADR para dos decisiones estructurales | El *porqué* vive en comentarios dispersos | [[02-architecture/adr/index]] |
| `TD-10` | **Sin purga de `outbox_events` procesados** (verificado) | La tabla de mayor tasa de inserción crece sin límite | [[14-audits/risks-register\|DATA-003]] |

## Deuda que NO se encontró

Vale la pena decir qué **no** es deuda aquí:

- **Sin dependencias circulares** — cero `forwardRef`.
- **Sin librerías duplicadas para la misma responsabilidad** — validación solo con Zod.
- **Sin `any` disperso** — el tipado es estricto.
- **Sin modelos ORM en el transporte** — siempre pasan por mapper.
- **Sin configuración leída ad hoc** con `process.env` por el código.

## Priorización sugerida

1. `TD-10` — el crecimiento sin límite acaba siendo un incidente, no una molestia.
2. `TD-06` y `TD-07` — baratos de resolver, y ambos inducen a error.
3. `TD-08` — limpiar variantes de script reduce confusión operativa.
4. `TD-03` y `TD-04` — estructurales; conviene decidirlos antes de que crezcan más.

## Relaciones

- [[14-audits/risks-register]] · [[11-quality/coverage-gaps]] · [[02-architecture/architecture-risks]]
