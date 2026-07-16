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

## Línea base medida (15-jul-2026)

Suite completa: **110 suites, 1006 tests, verdes**. Total del repo: statements 62.61 · branches 45.18 ·
functions 39.35 · lines 62.88.

> Trinquete ya aplicado una vez: al cubrir el rate limit distribuido y el interceptor de idempotencia
> (Fase 1.3), el "resto" subió de 61.91/43.97/38.20/62.22 → **62.38/44.36/38.88/62.66**, y los
> umbrales se subieron en consecuencia para fijar la ganancia.

| Grupo | stmts | branch | funcs | lines | Umbral fijado |
| ----- | ----: | -----: | ----: | ----: | ------------- |
| **global** (= "resto", ver nota) | 62.38 | 44.36 | 38.88 | 62.66 | 62 / 44 / 38 / 62 |
| `src/modules/auth/` | 54.22 | 41.26 | 36.54 | 54.37 | 54 / 41 / 36 / 54 |
| `src/modules/risk/` | 74.14 | 78.29 | 43.18 | 72.26 | 74 / 78 / 43 / 72 |
| `src/modules/fraud/` | 65.75 | 80.00 | 25.00 | 62.12 | 65 / 79 / 25 / 62 |
| `src/common/utils/crypto/` | 83.83 | 71.43 | 75.76 | 85.63 | 83 / 71 / 75 / 85 |

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

1. **`auth`** (54% stmts, 36% funcs) — es el dominio crítico más bajo.
2. **`fraud`** (25% funcs) — cobertura de funciones muy baja pese a buen branch.
3. **`risk`** (43% funcs).
4. `crypto` ya está cerca (83–85%); subirlo a 90 es el más barato.

## Reportes

`yarn test:coverage` emite `text-summary`, `text`, `lcov`, `json-summary` y `clover`. El job de CI
publica `coverage/lcov-report` (HTML navegable), `coverage-summary.json` y `lcov.info` como artefacto
`atlas-coverage` (14 días de retención).

## Rendimiento de la suite

`maxWorkers: '50%'` y `testTimeout: 15000` están fijados en `jest.config.cjs`. El `maxWorkers` por
defecto sobre-suscribía CPU: fijarlo bajó la suite completa de **~168 s a ~88 s**. No se limita el
proceso completo (el corte previo de 60 s mataba la suite y ocultaba que en realidad pasa).
