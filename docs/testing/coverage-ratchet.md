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

## Línea base medida (17-jul-2026)

Suite completa: **124 suites, 1154 tests, verdes**. Total del repo: statements 64.05 · branches 46.19 ·
functions 40.97 · lines 64.39.

> Trinquete subido tras: KMS (Fase 3.3), extracción de `AuthActorResolver`/`AuthPasswordReset` y el
> 2FA/MFA (Fases 2.2/4.2), observabilidad y métricas de negocio (Fase 3.4), y los specs directos de
> `FraudRepository` y `RiskRepository` (Fase 1.2).
>
> Ganancias clave: **fraud 25% → 100% de funciones** y **risk 43% → 68% de funciones** (90.8% stmts).
> En ambos casos la causa era la misma: el repositorio del dominio no tenía spec propio — servicio y
> controller lo mockean, así que sus funciones nunca se ejercitaban.

| Grupo | stmts | branch | funcs | lines | Umbral fijado |
| ----- | ----: | -----: | ----: | ----: | ------------- |
| **global** (= "resto", ver nota) | 63.70 | 45.39 | 40.06 | 64.04 | 63 / 45 / 39 / 63 |
| `src/modules/auth/` | 74.10 | 57.70 | 66.10 | 74.60 | 73 / 56 / 65 / 73 |
| `src/modules/risk/` | 90.80 | 78.29 | 68.20 | 91.00 | 89 / 78 / 67 / 89 |
| `src/modules/fraud/` | 93.20 | 80.00 | 100.0 | 92.40 | 90 / 79 / 95 / 90 |
| `src/common/utils/crypto/` | 89.00 | 73.50 | 88.60 | 90.40 | 88 / 73 / 87 / 90 |

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

1. **El "resto" (64%)** es lo que separa del objetivo global de 85%: muchos módulos con
   servicio+controller testeados pero repositorio sin spec. El patrón que funcionó en `fraud`,
   `risk`, `auth`, `operations` y `external-data` (spec directo del repositorio con modelos
   mockeados) es replicable módulo a módulo. Repos grandes aún sin spec: `customer-telemetry`
   (558), `systems-catalog` (541), `schema-management` (475), y los sub-repos de sessions/onboarding.
2. **`auth`** (74% stmts, 66% funcs) — subió mucho con `auth.repository`; para llegar a 90 faltan las
   ramas de `verifyLoginPin`/rotación de refresh en `auth.service`.
3. `crypto` (89%) — el más barato de llevar a 90+.
4. **`risk`** (68% funcs) — ya 90% stmts; faltan los `create*` del repositorio.

## Reportes

`yarn test:coverage` emite `text-summary`, `text`, `lcov`, `json-summary` y `clover`. El job de CI
publica `coverage/lcov-report` (HTML navegable), `coverage-summary.json` y `lcov.info` como artefacto
`atlas-coverage` (14 días de retención).

## Rendimiento de la suite

`maxWorkers: '50%'` y `testTimeout: 15000` están fijados en `jest.config.cjs`. El `maxWorkers` por
defecto sobre-suscribía CPU: fijarlo bajó la suite completa de **~168 s a ~88 s**. No se limita el
proceso completo (el corte previo de 60 s mataba la suite y ocultaba que en realidad pasa).
