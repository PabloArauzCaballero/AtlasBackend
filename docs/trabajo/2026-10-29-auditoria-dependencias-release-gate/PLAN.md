# Plan — release-gate en rojo por la auditoría de dependencias (AtlasBackend)

- Fecha: 2026-10-29 · Repos afectados: AtlasBackend · Predecesor: PR #282 (`test`), que muestra el fallo
- Resultado observable: el job `yarn audit (dependencias con vulnerabilidades high/critical)` termina en `PASS` y `release-gate` deja de fallar por él.
- Kill-test: `node scripts/security/audit-dependencies.mjs` sigue saliendo con código 2 (`BLOCKED_FINDINGS`).

## Hallazgos (reproducidos en local, mismo resultado que el job de CI)
- `release-gate` no tiene lógica propia: agrega los jobs `needs`. El único en `failure` era `dependency-audit` (job 121883202805, run 40411541657).
- Avisos high sin excepción vigente (`.github/audit-exceptions.json` no existe): multer GHSA-q7qp-rjg7-q26m (parche ≥2.5.0), zod GHSA-mrhx-c7xc-m3w5 (≥4.6.6, también vía `@scalar/nestjs-api-reference`), body-parser GHSA-27r3-jxmh-p828 (≥2.4.0, vía `express` y `@nestjs/platform-express`).
- Versiones instaladas: multer 2.3.0, zod 4.6.5, body-parser 2.3.0. Las versiones parcheadas existen en el registro de npm (2.5.0, 4.6.6/4.6.7, 2.4.0).
- El fallo está en la base `test` también (no lo introduce el PR #282).

## Alcance
- IN: `package.json` (`zod`, `resolutions`), `yarn.lock`, este plan y su reporte.
- OUT: cualquier otro aviso (moderate/low), actualizar `express`/`@nestjs/*`, el código de la app, el PR #282.
- Ambigüedades registradas: ninguna.

## H1 — Auditoría de dependencias en verde
**CA:** Dado `dev`/`test` con las tres dependencias vulnerables, cuando se corre la auditoría del repo, entonces no hay avisos high/critical sin excepción y el gate sale con 0.
**DoD:** `node scripts/security/audit-dependencies.mjs` → PASS · `yarn type-check` · `yarn lint` · tests unitarios que tocan body parsing/multer/zod.
**Estado:** HECHO

### H1.S1 — Subir las tres dependencias
| ID | Microtarea | CA (binario) | DoD | Estado |
|---|---|---|---|---|
| H1.S1.M1 | `zod` ^4.6.6 y resoluciones `multer` ^2.5.0, `body-parser` ^2.4.0; regenerar `yarn.lock` | `yarn.lock` resuelve multer ≥2.5.0, body-parser ≥2.4.0, zod ≥4.6.6 | `yarn why multer body-parser zod` | HECHO |
| H1.S1.M2 | La auditoría del repo pasa | decisión `PASS` | `node scripts/security/audit-dependencies.mjs` → exit 0 | HECHO |
| H1.S1.M3 | Nada se rompe en la capa tocada | tipos, lint y pruebas dirigidas en verde | `yarn type-check && yarn lint` · `yarn jest` dirigido | HECHO |

## Riesgos y bloqueos previstos
| Riesgo | Impacto | Mitigación |
|---|---|---|
| multer 2.5.0 / body-parser 2.4.0 cambian comportamiento de límites o parseo | Subidas o JSON rechazados | Correr las pruebas que ejercitan upload y body-parser; declarar lo que no se cubra |
