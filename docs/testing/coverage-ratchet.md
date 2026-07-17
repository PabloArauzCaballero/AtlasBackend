# Gate de cobertura por trinquete

Implementa la Fase 1.2 del plan 10/10. La configuración vive en `jest.config.cjs`
(`coverageThreshold`) y la aplica el job `coverage` de CI (`yarn test:coverage`).

## Principio

Los umbrales **no** son aspiracionales: están fijados en el nivel **real medido**, con ~1 punto de
margen. Su función es **impedir regresiones** — un PR que baje la cobertura falla el merge. Cada
sprint se suben los números (el "trinquete") hasta el objetivo del plan.

| | Objetivo del plan |
|---|---|
| Global | ≥ 85% |
| auth / risk / fraud / crypto | ≥ 90% |

## Línea base medida (16-jul-2026)

Suite completa: **119 suites, 1089 tests, verdes**. Total del repo: statements 63.33 · branches 45.45 ·
functions 39.97 · lines 63.65.

> Trinquete subido de nuevo tras: los tests del proveedor activo de KMS (Fase 3.3), la extracción de
> `AuthActorResolver`/`AuthPasswordReset` (Fase 2.2), el spec directo de `FraudRepository` y la
> observabilidad (Fase 3.4, "resto" al 62.90/44.55/39.04/63.22). Ganancia clave: **fraud pasó de 25%
> a 100% de funciones cubiertas**.

| Grupo | stmts | branch | funcs | lines | Umbral fijado |
| ----- | ----: | -----: | ----: | ----: | ------------- |
| **global** (= "resto", ver nota) | 62.90 | 44.55 | 39.04 | 63.22 | 62 / 44 / 38 / 62 |
| `src/modules/auth/` | 57.20 | 45.00 | 37.50 | 57.20 | 56 / 43 / 37 / 56 |
| `src/modules/risk/` | 74.14 | 78.29 | 43.18 | 72.26 | 74 / 78 / 43 / 72 |
| `src/modules/fraud/` | 93.20 | 80.00 | 100.0 | 92.40 | 90 / 79 / 95 / 90 |
| `src/common/utils/crypto/` | 85.00 | 71.43 | 80.00 | 86.70 | 84 / 71 / 78 / 86 |

> **Nota importante sobre Jest:** cuando se declaran umbrales por *path*, los archivos que hacen match
> se **restan** del cómputo `global`. Por eso el umbral `global` está calibrado contra el **resto**
> (61.91/43.97/38.20/62.22), no contra el total del repo (62.18). Calibrarlo contra el total dejaría
> el gate mal ajustado.

## Cómo subir el trinquete

1. Añade tests al dominio que quieras mejorar.
2. Corre `yarn test:coverage` y mira el nuevo porcentaje real.
3. Sube el umbral correspondiente en `jest.config.cjs` hasta ~1 punto por debajo del nuevo real.
4. Commitea umbral + tests juntos: así el nivel queda bloqueado y no puede retroceder.

Prioridad sugerida (los más lejos del objetivo y más críticos):

1. **`auth`** (57% stmts, 37% funcs) — sigue siendo el dominio crítico más bajo; el objetivo es 90%.
2. **`risk`** (43% funcs) — buen branch, funciones bajas.
3. `crypto` ya está cerca (85–87%); subirlo a 90 es el más barato.
4. `fraud` ya en 93/100 — mantener; falta cerrar el resto del repo hacia el 85% global.

## Reportes

`yarn test:coverage` emite `text-summary`, `text`, `lcov`, `json-summary` y `clover`. El job de CI
publica `coverage/lcov-report` (HTML navegable), `coverage-summary.json` y `lcov.info` como artefacto
`atlas-coverage` (14 días de retención).

## Rendimiento de la suite

`maxWorkers: '50%'` y `testTimeout: 15000` están fijados en `jest.config.cjs`. El `maxWorkers` por
defecto sobre-suscribía CPU: fijarlo bajó la suite completa de **~168 s a ~88 s**. No se limita el
proceso completo (el corte previo de 60 s mataba la suite y ocultaba que en realidad pasa).
