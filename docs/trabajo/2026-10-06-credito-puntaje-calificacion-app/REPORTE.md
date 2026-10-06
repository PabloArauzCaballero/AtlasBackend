# Reporte — Crédito habilitado, Puntaje y Calificación (fullstack)

> **AVANCE: 24 / 26 — 92,3 %.** Faltan 2: H1.S1.M1 contra el motor de **dev en vivo** (A MEDIAS: verificado sólo contra la definición versionada) y H3.M3 recorrido real admin → app (BLOQUEADO: sin backend levantado). Push a GitHub BLOQUEADO (403).

- Fecha: 2026-10-06 · Plan: [PLAN.md](./PLAN.md) · Plan hermano de la app: `AtlasFrontend/docs/trabajo/2026-10-06-entrada-puntaje-bot/`
- Rama: `claude/plan-credito-calificacion-mobile-b95b6f` en AtlasBackend, AtlasFrontend y AtlasAdminPortal (motor sin cambios)
- Peldaño: app `VERIFIED` (web export con backend simulado en el navegador, 3 anchos) · backend `TESTED` · AdminPortal `TESTED` · motor `TESTED` (definición)

## Completado
| ID | Qué se logró | Comando | Resultado |
|---|---|---|---|
| H1.S1.M1 (parcial) | El artefacto `ATLAS_BNPL_UNDERWRITING` v2.1 publica `approved_credit_limit` con rol `APPROVED_LIMIT` (banda E → 0) | `npx jest test/atlas-underwriting-v2.spec.ts` (motor) | PASS 70/70 |
| H1.S1.M2 | El monto escrito es el del motor: correcto (900 + ejecución), límite (0 se respeta, no se sustituye por capacidad), inválido (motor caído → no escribe) | `npx jest test/unit/credit/credit-line-recalculation-basis.spec.ts` | PASS 10/10 |
| H1.S1.M3 · H2.S1.M4 | Matriz negativa de `/credit-line` y `/progress`: sin token 401, otro cliente 403, comercio 403, otro tenant rechazado, propio 200 | `npx jest test/e2e/credit/credit-line-progress-authz.spec.ts` | PASS 10/10 |
| H1.S2.M1–M4 | Tarjeta «Crédito habilitado» con procedencia del motor y 4 estados | `npx jest __tests__/portada-orden.test.tsx` + capturas `10-inicio-*` | PASS 11/11, capturas revisadas |
| H2.S1.M1–M3 | `/progress` publica `rating` (1–100) y `points`; OpenAPI actualizado | `npx jest test/unit/credit/payer-rating.spec.ts credit-progress.service.spec.ts` | PASS |
| H2.S2.M1–M7 | App: Puntaje = puntos por pagar; Calificación 1–100; 0–1000 = «índice de crédito»; letra = «categoría de riesgo»; subpestañas | `npx jest` (app) + capturas `11-*`, `12-*` | PASS 83 suites / 820 |
| H2.S3.M1 | AdminPortal: panel «Puntaje y calificación» en la ficha; «Índice de crédito del motor»; «Categoría de riesgo del cliente» | `npx vitest run` (admin) | PASS 336 archivos / 3173 |
| H3.M1 | La tarjeta Normal…Black sale del nivel de la misma calificación publicada | `credit-progress.service.spec.ts` | PASS 10/10 |
| H3.M2 | Ajuste manual auditado (ya cubierto) | `card-tier.service.spec.ts:112,244` | PASS (existente) |
| H4.M1 | Gates backend | `yarn type-check` · `type-check:tests` · `lint` · `format:check` · jest unit+e2e | 0 errores · 0 · 0 errores (109 avisos, igual que antes) · OK · 8007/8008 (ver abajo) |
| H4.M2 | Gates app | `tsc` · `eslint` · `jest` | 0 · 0 errores (14 avisos, igual que antes) · 820/820 |
| H4.M3 | Gates AdminPortal | `tsc` · `eslint` · `format:check` · `vitest` | 0 · 0 · OK · 3173/3173 |

## A medias
### H1.S1.M1 — artefacto asignado en dev
- Qué anda: la definición versionada del artefacto declara y produce `approved_credit_limit` (70 pruebas del motor).
- Qué no anda: no se consultó al motor de dev en vivo qué versión está DESPLEGADA para `CREDIT_LINE`.
- Qué falta exactamente: `GET` de la asignación del artefacto en el portal del motor de dev y confirmar versión ≥ 2.1.0.
- Dónde quedó: sin cambios de código; no hay motor accesible desde este entorno.

## Pendiente
| ID | Estado | Qué lo destraba |
|---|---|---|
| Push de las 3 ramas | BLOQUEADO | Instalar la app de Claude con escritura en los repos o reconectar GitHub |
| H3.M3 recorrido real admin → app | BLOQUEADO | Backend + base levantados; cubierto con pruebas de cada lado |

## Evidencia
```text
AtlasBackend $ npx jest --testPathPatterns='test/(unit|e2e)'
Test Suites: 1 failed, 747 passed, 748 total
Tests:       1 failed, 8007 passed, 8008 total
FAIL test/unit/common/logging/app-file-logger-degrades.spec.ts  ← falla IGUAL sin estos cambios (git stash): ENVIRONMENT, ajena
AtlasAdminPortal $ npx vitest run → Test Files 336 passed · Tests 3173 passed
consumer-app $ npx jest → Test Suites 83 passed · Tests 820 passed
motor $ npx jest test/atlas-underwriting-v2.spec.ts → Tests 70 passed
```
Capturas (app, datos SINTÉTICOS de demostración, cliente ficticio 42): `AtlasFrontend/docs/trabajo/2026-10-06-entrada-puntaje-bot/evidencia/10-inicio-*.png`, `11-puntaje-mis-puntos-*.png`, `12-puntaje-mi-calificacion-*.png` (móvil, tablet, escritorio).

## No cubierto
- Capturas internas con backend SIMULADO en el navegador, no con el backend real; los 54 errores de consola de esa corrida son los 404 de rutas no simuladas (préstamos, gastos, calendario…).
- AdminPortal sin captura visual: sólo pruebas de componente.
- Tema claro: la app sólo tiene oscuro.

## Desvíos del plan
- A4: el 0–1000 del motor se renombró a «índice de crédito», no se ocultó.
- En el desglose se quitó el sufijo «pts» y en el historial «pts de nivel» → «calificación N», para no volver a mezclar puntos y calificación.
- `test/unit/common/logging/app-file-logger-degrades.spec.ts` en rojo, preexistente y ajena; no se tocó.

## Riesgos residuales
- A1 sigue siendo supuesto: la Calificación es la puntuación de relación existente.
- Las frases por tramo de la calificación (80/60/40) son de presentación, no política.

## Decisiones y ambigüedades
- A1–A5 tomadas con el supuesto recomendado; confirmar con Pablo.
