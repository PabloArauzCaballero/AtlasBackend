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

## Fix del flake del gate (determinismo con un solo worker)

Síntoma: el job de coverage fallaba **intermitentemente** con `Coverage data for ./src/modules/auth/
was not found` (exit 1) aunque **todos los tests pasaban** y el `global` cumplía. Causa: al correr con
varios workers, Jest **fusiona** los coverage maps de cada worker al final; bajo presión de memoria un
worker se reinicia/OOM y su parte del mapa se pierde, dejando un grupo con umbral propio (p. ej.
`auth`) sin datos justo cuando se evalúa el threshold.

Fix (en `jest.config.cjs`): cuando la corrida lleva `--coverage`, `maxWorkers` se fuerza a `1`
(`isCoverageRun`). Con un único worker no hay fusión entre procesos → el cómputo es determinista. El
dev loop (`yarn test`, sin `--coverage`) mantiene `maxWorkers: '50%'` y sigue siendo rápido; solo el
GATE corre in-band. `collectCoverageFrom` (instrumentar todo `src`, no solo lo importado por los
tests que corrieron) ya estaba y se mantiene: garantiza que cada grupo de umbral tenga datos.

## Línea base medida (19-jul-2026, in-band, 1770 tests)

Suite completa: **234 suites, 1770 tests, verdes** (exit 0, sin flake). Total del repo: statements 80.99 ·
branches 63.13 · functions 70.64 · lines 81.70.

> Re-baseline tras cubrir el service layer de `auth` extraído (74→86 stmts) y las ramas profundas de
> `external-data-execution` (bloqueo por política, cache-hit, fallo de ejecución, preview). Los 4 paths
> con umbral propio se ratchetean a su nivel real (working tree limpio bajo ellos → reproducible en CI).
> El **`global` NO se sube**: su medición (resto 80.47/62.50/70.18/81.18) está inflada por 3 specs
> untracked ajenas del "resto" (`http-exception.filter`, `domain-schemas`, `admin-read.service`) que
> CI no vería; subirlo dejaría el gate por encima de lo reproducible. Se mantiene en 77/58/66/77.

| Grupo | stmts | branch | funcs | lines | Umbral fijado |
| ----- | ----: | -----: | ----: | ----: | ------------- |
| **global** (= "resto", ver nota) | 82.23 | 63.55 | 74.58 | 82.97 | 79 / 60 / 70 / 79 |
| `src/modules/auth/` | 96.56 | 74.53 | 94.92 | 97.14 | 94 / 72 / 92 / 95 |
| `src/modules/risk/` | 98.85 | 81.40 | 100.0 | 100.0 | 97 / 80 / 98 / 98 |
| `src/modules/fraud/` | 97.26 | 80.00 | 100.0 | 96.97 | 95 / 79 / 98 / 95 |
| `src/common/utils/crypto/` | 91.33 | 77.55 | 94.29 | 92.77 | 90 / 75 / 92 / 91 |

> Bump del global **77/58/66/77 → 79/60/70/79** (2026-07-19, 1er lote): controller+repo de external-data,
> catalog-management.repo, runtime-jobs.service, systems-catalog-query.service, adapters email/push/whatsapp,
> suite-admin.repo → "resto" 82.23/63.55/74.58/82.97 (repo total 82.65).
>
> Bump del global **79/60/70/79 → 81/62/74/81** (2026-07-19, 2º lote): data-quality.repo, notifications.repo
> (159 stmts, NO era delegador puro), sessions-device/telemetry.repo, health-monitor lifecycle,
> mail-sender.client, systems-test-http-client, mongo-logs-query → "resto" **84.31/64.95/77.83/85.13** (repo
> total **84.61 stmts / 85.41 lines** — cruzando el objetivo de 85% en líneas · 238 suites / 1865 tests).
> Functions +3.25 pt. Colchón ~3-4 pt para la inflación de los 3 specs untracked ajenos.
>
> Empuje de DOMINIOS CRÍTICOS hacia el objetivo del plan ≥90% (2026-07-19): **auth 84/65/68/84 →
> 94/72/92/95** (86.51→96.56 stmts / 69.49→94.92 funcs, tras cubrir auth.controller, verifyLoginPin y
> auth.repository) y **risk 90/79/69/90 → 97/80/98/98** (91.38→98.85 stmts / 70.45→100 funcs, tras los 11
> create* de RiskRepository + getDetail/getExplanation). fraud (95/79/98/95) y crypto (90/75/92/91) sin
> cambio. Colchón más ajustado (~1.5-2.5 pt): estos paths no dependen de specs untracked ni de código sin
> commitear, así que son reproducibles en CI. El branch (72-80%) es la métrica rezagada en los 4 dominios.

## Línea base previa (17-jul-2026)

Suite completa: **160 suites, 1395 tests, verdes**. Total del repo: statements 69.00 · branches 49.49 ·
functions 50.42 · lines 69.61.

> Trinquete subido tras: KMS (Fase 3.3), extracción de `AuthActorResolver`/`AuthPasswordReset` y el
> 2FA/MFA (Fases 2.2/4.2), observabilidad y métricas de negocio (Fase 3.4), y los specs directos de
> `FraudRepository`, `RiskRepository`, `AuthRepository`, los repos de operations/external-data/
> customer-telemetry/schema-management/systems-catalog/internal-rbac, los sub-repos de sessions
> (lifecycle, location, device, telemetry, onboarding-link, activity-audit) y de onboarding
> (flow, contact-verification, identity-evidence, address-status), `AuditRepository` (feed de 8
> fuentes + paginación por cursor), `ConsentsRepository`, `EventsRepository` (outbox +
> claimPending), `CustomerPrivacyRepository`, `CustomersRepository`, `InternalAccessCatalogRepository`,
> `SystemsActionLogRepository`, `SystemsReviewRepository`, y el cierre con TODOS los repos con lógica
> real: los 6 restantes de systems-ops (`SystemsTestExecution`, `SystemsDataImpactInference`,
> `SystemsToolInference`, `SystemsDashboard`, `SystemsStressProfile`, `SystemsTestSuiteAdmin`) y los 2
> sub-repos de notifications (`NotificationPreferences`, `NotificationTemplates`). Fase 1.2.
>
> A partir de aquí ya NO quedan repositorios con lógica real sin spec (los 4 sin cubrir son fachadas
> puramente delegadoras). Para seguir subiendo hacia el 85% global toca cubrir ramas de
> servicios/controllers, no repos.
>
> Ganancias clave: **fraud 25% → 100% de funciones** y **risk 43% → 68% de funciones** (90.8% stmts).
> En ambos casos la causa era la misma: el repositorio del dominio no tenía spec propio — servicio y
> controller lo mockean, así que sus funciones nunca se ejercitaban.

| Grupo | stmts | branch | funcs | lines | Umbral fijado |
| ----- | ----: | -----: | ----: | ----: | ------------- |
| **global** (= "resto", ver nota) | 68.18 | 48.42 | 48.87 | 68.75 | 67 / 47 / 47 / 67 |
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
