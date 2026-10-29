> **AVANCE: 3 / 4 — 75,0 %.**

- Fecha: 2026-10-29 · Plan: [PLAN.md](./PLAN.md) · Rama: `claude/compassionate-franklin-p7u3rw`
- Peldaño de evidencia alcanzado: `TESTED` (pruebas dirigidas verdes). No hay `VERIFIED`: no se reprodujo end-to-end.

## Completado
| ID | Qué se logró | Comando | Resultado |
|---|---|---|---|
| H1.S1.M1 | `fitToColumn` recorta a ≤ max con «…» solo si recortó | `yarn test:unit` (column-fit.spec, 6 pruebas) | PASS |
| H1.S1.M2 | `decisionReason`/`rejectionReason` se ajustan a 120/200 en `partner-kyb-sync`, `partner-profile` y en `escribirDecision` (único punto de escritura de la verificación) | `yarn type-check` exit 0 · `yarn type-check:tests` exit 0 · `yarn check:file-size` OK | PASS |
| H2.S1.M1 | OBS-19: el catálogo de eventos trae `reservedForSystem` (aditivo) | `yarn jest test/unit/events test/unit/openapi` | PASS (126) · type-check y type-check:tests exit 0 · check:file-size OK |

## A medias
### H1.S1.M3 — Reproducción end-to-end del BUG-1
- Qué anda: el recorte está cubierto por pruebas unitarias y el código compila.
- Qué no anda: no se verificó contra Postgres que el job `sync_partner_kyb_reviews` apruebe con un comentario de 300 caracteres.
- Qué falta exactamente: reconstruir `dist`, reiniciar AtlasBackend, aprobar un expediente con motivo largo y leer `partner_profiles.decision_reason`.
- Dónde quedó: rama indicada, compila.

## Pendiente
| ID | Estado | Qué lo destraba |
|---|---|---|
| — | ninguno | — |

## Evidencia
```text
yarn type-check / type-check:tests / check:file-size -> exit 0 / OK
yarn test:unit -> Test Suites: 2 failed, 804 passed; Tests: 1 failed, 8184 passed
```

## No cubierto
- `yarn test:unit`: 2 suites fallan **también sin mis cambios** (`ops/monitor-ruido.spec.ts` por `ssh-keygen`, `common/logging/app-file-logger-degrades.spec.ts` por permisos de escritura del entorno). Clase `ENVIRONMENT`.
- `yarn lint`: 0 errores (107 avisos preexistentes).

## Desvíos del plan
- El recorte de `partner-verification.service.ts` se movió a `escribirDecision` porque el archivo ya rozaba el límite de 300 líneas del trinquete.

## Riesgos residuales
- Un motivo recortado pierde texto: el original sigue en la ejecución del Motor.

## Decisiones y ambigüedades
- Se recorta en vez de ampliar la columna (no se toca el esquema); confirmar con el equipo si prefieren migrar a TEXT.
