> **AVANCE: 3 / 3 — 100,0 %.**

# Reporte — release-gate en rojo por la auditoría de dependencias (AtlasBackend)

- Fecha: 2026-10-29 · Plan: [PLAN.md](./PLAN.md) · Rama: `claude/atlas-repos-pending-prs-drim5p`
- Peldaño de evidencia alcanzado: `TESTED` (auditoría del repo, tipos, lint y pruebas dirigidas ejecutados en local). No se ejecutó el CI real sobre estos cambios: no hay `VERIFIED` ni `REGRESSION_VERIFIED`.

## Causa
`release-gate` solo agrega el resultado de los demás jobs. En el PR #282 (run 40411541657) el único job en `failure` entre los obligatorios era `dependency-audit`: `BLOCKED_FINDINGS`, 5 rutas con 3 avisos high sin excepción vigente: multer (GHSA-q7qp-rjg7-q26m), zod (GHSA-mrhx-c7xc-m3w5) y body-parser (GHSA-27r3-jxmh-p828). Fallan igual en la base `test`; el PR #282 no toca dependencias.

## Completado
| ID | Qué se logró | Comando | Resultado |
|---|---|---|---|
| H1.S1.M1 | `zod` ^4.6.6 y resoluciones `body-parser` ^2.4.0, `multer` ^2.5.0, `zod` ^4.6.6; `yarn.lock` regenerado | `node -p` sobre `node_modules` | multer 2.5.0, body-parser 2.4.0, zod 4.6.7 — [evidencia](./evidencia/tipos-lint-versiones.txt) |
| H1.S1.M2 | La auditoría del repo pasa | `node scripts/security/audit-dependencies.mjs` | `PASS`, exit 0 (antes: `BLOCKED_FINDINGS`, exit 2) — [evidencia](./evidencia/audit-dependencies.txt) |
| H1.S1.M3 | Tipos, lint y pruebas dirigidas en verde | `yarn type-check`, `yarn type-check:tests`, `yarn lint`, jest dirigido | exit 0 los tres; 0 errores de lint (107 avisos preexistentes, tope 109); 83 suites / 799 tests PASS — [evidencia](./evidencia/jest-dirigido.txt) |

## A medias
Ninguna.

## Pendiente
| ID | Estado | Qué lo destraba |
|---|---|---|
| Que este cambio llegue a `dev`/`test` y al PR #282 | TODO | Abrir un PR con esta rama y mergearlo; luego actualizar la rama del PR #282 con la base |

## Evidencia
Ver `evidencia/`: `audit-dependencies.txt`, `tipos-lint-versiones.txt`, `jest-dirigido.txt`.

## No cubierto
- El CI real sobre este cambio (los jobs de GitHub no corrieron sobre esta rama).
- La suite completa, las pruebas de integración contra Postgres/Redis y los E2E. Solo se corrió `test/unit/{files,bootstrap,auth,customer-onboarding}`.
- El comportamiento en ejecución de multer 2.5.0 y body-parser 2.4.0 (upload real y límites del cuerpo): solo lo cubren las pruebas unitarias `multer-ingest.adapter`, `file.service` e `internal-mail-body-parser`.
- zod pasó de 4.6.5 a 4.6.7 en todos los módulos; las pruebas dirigidas no recorren todos los esquemas.

## Desvíos del plan
- La primera resolución dejó un aviso: `@scalar/types` traía su propia copia de zod 4.6.5. Se añadió `zod` a `resolutions` (no estaba en el plan).

## Riesgos residuales
- `resolutions` fuerza versiones por encima de lo que piden `express` y `@nestjs/platform-express`; si estos publican versiones con el parche, la resolución sobra y conviene retirarla.

## Decisiones y ambigüedades
- Se subieron las dependencias en vez de crear una excepción en `.github/audit-exceptions.json`: los tres parches existen y no implican cambio mayor.
