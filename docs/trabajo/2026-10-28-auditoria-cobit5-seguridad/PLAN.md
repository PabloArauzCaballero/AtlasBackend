# Plan — Auditoría de seguridad AtlasBackend mapeada a COBIT 5

- Fecha: 2026-10-28 · Repos afectados: AtlasBackend (únicamente) · Predecesor: ninguno
- Resultado observable: informe de hallazgos verificados contra el código (archivo:línea), con mapeo a procesos COBIT 5 (APO13, DSS05, DSS06, BAI06, APO12, MEA01-03), y corrección mínima con test de las vulnerabilidades confirmadas de severidad media o superior.
- Kill-test: un hallazgo reportado que al releer el código real no exista (falso positivo), o una corrección sin test que la demuestre.
- Aclaración: COBIT 5 es un marco de gobierno. Este trabajo entrega mapeo hallazgo→proceso y evidencia técnica; NO es una certificación.

## Alcance
- IN: `src/`, `test/`, `Dockerfile*`, `docker-compose*.yml`, `.env*.example`, `.github/`, configuración, dependencias (lockfile).
- OUT: otros repos (portal, motor, dashboards), infraestructura de terceros, refactors no relacionados, hallazgos de severidad baja (se anotan, no se corrigen).
- Ambigüedades registradas: ninguna al abrir.

## H1 — Descubrimiento y hallazgos verificados
**CA:** Dado el repo, cuando se revisan los vectores solicitados, entonces cada hallazgo queda citado con archivo:línea tras leer el código real.
**DoD:** hallazgos en REPORTE.md; salidas en `evidencia/`.
**Estado:** A MEDIAS (exploración dirigida y muestreada; no exhaustiva sobre ~1900 archivos, ver REPORTE "No cubierto")

| ID | Microtarea | CA (binario) | DoD | Estado |
|---|---|---|---|---|
| H1.S1.M1 | Secretos en repo/compose/Dockerfile | Coincidencias clasificadas | `git grep` (sin secretos reales hallados) | HECHO |
| H1.S1.M2 | Auth, JWT, cookies, refresh, throttling | Leído en código | jwt-auth.guard.ts, jwt-claims.util.ts, auth-cookies.util.ts | HECHO |
| H1.S1.M3 | Autorización/BOLA/tenant | Guards y script de cobertura revisados | `evidencia/gates-check-scripts.txt` | HECHO |
| H1.S1.M4 | Inyección SQL/SSRF/path traversal/uploads | SQL dinámico, fetch y storage leídos | citas en REPORTE | HECHO |
| H1.S1.M5 | CORS/helmet/webhooks/cripto/logs PII | Leído en código | citas en REPORTE | HECHO |
| H1.S1.M6 | Dockerfile, compose, CI y dependencias | `yarn audit` ejecutado | `evidencia/yarn-audit*.txt` | HECHO |

## H2 — Corrección y verificación de hallazgos >= medio
**CA:** Dado un hallazgo confirmado, cuando se aplica el fix mínimo, entonces un test dirigido lo demuestra y los gates aplicables pasan.
**Estado:** A MEDIAS (SEC-05 no corregido: requiere decisión de diseño)

| ID | Microtarea | CA (binario) | DoD | Estado |
|---|---|---|---|---|
| H2.S1.M1 | Instalar dependencias | node_modules presente | `evidencia/yarn-install.txt` exit=0 | HECHO |
| H2.S1.M2 | SEC-01 consola SQL: funciones que reciben SQL/tabla como literal | 9 casos rechazados; fallaban antes | `evidencia/jest-sql-console.txt` | HECHO |
| H2.S1.M3 | SEC-02 token de scrape de /metrics + test | 401 sin token, 200 con token, sin token no cambia | `evidencia/jest-dirigidos.txt` | HECHO |
| H2.S1.M4 | SEC-03 dependencias (multer, body-parser, zod, qs, moment) | `yarn audit --level high` prod = 0 | `evidencia/yarn-audit-despues.txt` | HECHO |
| H2.S1.M5 | SEC-04 compose local: puertos de datos solo a 127.0.0.1 | diff aplicado, YAML válido | `check:env-example` exit 0 | HECHO |
| H2.S1.M6 | SEC-05 consola SQL sin acotar por tenant | Fix o decisión registrada | REPORTE (Decisiones) | A MEDIAS |
| H2.S2.M1 | type-check y type-check:tests | exit 0 | `evidencia/typecheck.txt` | HECHO |
| H2.S2.M2 | eslint + prettier de archivos tocados; check:env-example; check:file-size | exit 0 | `evidencia/lint-format-checks.txt` | HECHO |
| H2.S2.M3 | `yarn test:unit` completo | sin fallos atribuibles al cambio | `evidencia/jest-unit-completo.txt` (2 suites ENVIRONMENT) | A MEDIAS |

## H3 — Reporte y commit
| ID | Microtarea | CA | DoD | Estado |
|---|---|---|---|---|
| H3.S1.M1 | REPORTE.md con mapeo COBIT 5 | AVANCE en la primera línea | `head -1 REPORTE.md` | HECHO |
| H3.S1.M2 | Commit sin push | solo mis archivos | `git show --stat` | HECHO |

## Riesgos y bloqueos previstos
| Riesgo | Impacto | Mitigación |
|---|---|---|
| Sin base Postgres en el entorno | Fix SEC-01/SEC-02 verificados a nivel unitario, no contra BD ni HTTP real | Declarado en "No cubierto" |
