# Reporte — Todo llega al Motor; sólo el crédito se aplica solo; nada se pierde

> **AVANCE: 7 / 7 — 100 %.**

- Fecha: 2026-10-06 · Plan: [PLAN.md](./PLAN.md) · Rama: `claude/dreamy-mayer-l6nev0` (base `test`)
- Peldaño de evidencia alcanzado: `TESTED` (unitarios + integración contra Postgres real + arranque real). No
  `VERIFIED` en el servidor: la sesión no alcanza `161.97.85.216` (puertos 22 y 8000 bloqueados).

## Completado
| ID | Qué se logró | Comando | Resultado |
|---|---|---|---|
| H1.S1.M1 | `DECISION_ENGINE_AUTO_APPLY` (por omisión `credit`) | `yarn type-check` · `yarn check:env-example` | PASS |
| H1.S1.M2 | Riesgo: veredicto del Motor queda como propuesta (`manual_review_required`) | jest risk-policy-decision | PASS |
| H1.S1.M3 | Comercio: veredicto del Motor queda `REVISION_MANUAL` | jest partner-kyb-decision | PASS |
| H1.S1.M4 | Identidad: retenida si `IDENTITY_REQUIRE_HUMAN_REVIEW` o si falta en la lista | jest mobile-identity, customers | PASS |
| H1.S2.M1 | Producto `requires_manual_review` consulta al Motor, retiene y abre caso | jest credit-underwriting | PASS |
| H1.S2.M2 | Diferida (P-09) abre caso; el reintento que la aprueba lo cierra | integración credit (35/35) | PASS |
| H1.S3.M1 | Gates + arranque real | ver Evidencia | PASS |

## A medias
ninguna

## Pendiente
| ID | Estado | Qué lo destraba |
|---|---|---|
| Diagnóstico en el servidor | BLOQUEADO | Acceso de red de la sesión a `161.97.85.216`, o que Pablo corra las consultas de abajo |

## Evidencia
```text
yarn type-check / type-check:tests / lint / format:check / check:file-size / check:architecture /
check:env-example / check:nest-entrypoints  → exit 0
yarn test:unit → Tests: 1 failed, 7505 passed, 7506 total
  (falla `app-file-logger-degrades`: también falla sin este cambio; el contenedor corre como root)
jest --config jest.integration.config.cjs test/integration/credit (PostgreSQL 16 local) → Tests: 35 passed
node dist/src/main.js (APP_ROLE=api) → "Atlas API escuchando en puerto 3005" · /api/v1/health → 200
```

## No cubierto
- El servidor real: no se vio por qué las solicitudes de producción no llegaban al Motor.
- Interfaz del portal sobre los casos nuevos (sin prueba visual).

## Desvíos del plan
- La primera versión se escribió sobre `main`, que está 650 commits detrás de `test`; se reaplicó sobre `test`
  reutilizando lo que ya existía allí (bandeja de crédito C-1, retención de identidad).

## Riesgos residuales
- Si la réplica de la base habilitante falla siempre (llave de gobierno ausente o sin rol), el crédito seguirá
  sin decidirse solo: ahora al menos queda en la bandeja. Consulta para confirmarlo en el servidor:
  `SELECT decision_reason_code, count(*) FROM credit.credit_applications WHERE status='submitted' GROUP BY 1;`
  y `SELECT status, last_error, count(*) FROM credit.decision_consent_replications GROUP BY 1,2;`

## Decisiones y ambigüedades
- Interpretación de «todo manual salvo crédito»: todo llega al Motor; sólo crédito se aplica. Confirmar con Pablo.
