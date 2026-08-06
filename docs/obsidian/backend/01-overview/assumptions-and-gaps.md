---
title: "Supuestos y vacíos"
type: "overview"
status: "verified"
owner: "unknown"
criticality: "high"
last_reviewed: "2026-08-06"
source_revision: "80fc741"
tags:
  - backend
  - overview
  - gaps
aliases: []
related: []
---

# Supuestos y vacíos

Qué se puede afirmar de esta documentación y qué no.

## Método

`VERIFICADO` — la bóveda se construyó por **análisis estático** del árbol de fuentes en la revisión `80fc741`:

- Rutas extraídas de los decoradores `@Controller`/`@Get`/`@Post`/…
- Modelo físico extraído de los decoradores `@Table`/`@Column` y de `ATLAS_DOMAIN_TABLES`
- Relaciones, CHECK e índices extraídos de las migraciones
- Variables de entorno extraídas de los esquemas Zod
- Eventos extraídos de `event-registry.ts`

**No se ejecutó** el backend, ni las pruebas, ni ninguna consulta contra una base de datos. Ninguna cifra de esta bóveda procede de un entorno vivo.

## Validación cruzada realizada

| Comprobación | Resultado |
|---|---|
| Rutas del código ↔ operaciones del contrato OpenAPI | 266 vs 265 — coinciden; la diferencia es `GET /metrics`, excluido a propósito del contrato |
| Tablas de modelos ↔ `ATLAS_DOMAIN_TABLES` | 130 de 130 resuelven esquema; ninguna quedó sin clasificar |
| Modelos sin columnas extraídas | 0 |
| `.env.example` ↔ esquema Zod | Contrastado; las diferencias están en [[15-reference/environment-variables]] |

## Lo que esta bóveda NO puede afirmar

> [!question] Pendiente — requiere ejecución o acceso a un entorno
> 1. **Que el esquema desplegado coincida con las migraciones.** Se documenta el esquema que *resultaría* de aplicar las 61 migraciones. Una divergencia en un entorno real solo se detecta consultándolo.
> 2. **Rendimiento.** Ninguna consulta se midió. Los hallazgos de rendimiento (p. ej. las 168 FK sin índice) son **riesgos estáticos**, no cuellos de botella confirmados. `yarn db:capture-query-baseline` existe para producir esa medición.
> 3. **Cobertura de pruebas real.** Se cuentan 304 archivos de test; no se ejecutó `yarn test:coverage`, así que no hay porcentaje de líneas cubiertas.
> 4. **Comportamiento de los proveedores externos.** Los adaptadores están documentados por su código; no se validaron contra ningún sandbox real.
> 5. **Volumetría.** No se conoce el número de filas, el crecimiento ni la distribución de datos en ningún entorno.
> 6. **SLO/SLA acordados.** No aparecen en el repositorio.
> 7. **Propietarios.** Ninguna nota tiene `owner` real: no hay `CODEOWNERS` ni asignación de equipos en el repositorio. Todas dicen `unknown`.

## Supuestos aplicados

| Supuesto | Base | Riesgo si es falso |
|---|---|---|
| Los comentarios `@business`/`@system` describen el propósito real | Presentes y consistentes en los 686 archivos | Definiciones de negocio imprecisas en las notas de entidad |
| El esquema Zod de entorno es la configuración efectiva | `parseEnv()` se ejecuta al importar `env.ts`, y lanza si falla | Variables leídas por otras vías quedarían sin documentar |
| La sensibilidad de un campo se puede inferir del sufijo (`_encrypted`, `_hash`, …) | Convención sostenida en las 130 tablas | Campos sensibles con nombre atípico quedarían sin clasificar |
| Las 61 migraciones se aplican siempre en orden y por completo | Umzug con tracking en `public` | El modelo físico documentado no correspondería a un entorno parcialmente migrado |

Las clasificaciones de sensibilidad de datos están marcadas `INFERIDO` en cada nota de entidad, precisamente por el tercer supuesto.

## Vacíos de documentación conocidos

| Vacío | Estado |
|---|---|
| Runbooks para incidentes de proveedores externos concretos | Solo hay runbooks genéricos; ver [[10-operations/runbooks/index]] |
| ADR sobre la separación en 12 esquemas de dominio | No existe; la decisión se infiere del código |
| Contrato de eventos para consumidores externos | `asyncapi/` existe pero no se contrastó con `event-registry.ts` |
| Diagramas de secuencia por caso de uso de negocio | Solo se documentaron los flujos críticos; ver [[02-architecture/critical-sequences]] |

## Elementos sin resolver

El registro vivo está en [[_meta/unresolved-items]].

## Relaciones

- [[14-audits/documentation-coverage]] · [[14-audits/contradictions]] · [[_meta/generation-log]]
