> **AVANCE: 15 / 17 — 88,2 %.**

# Reporte — Auditoría de seguridad de AtlasBackend mapeada a COBIT 5

- Fecha: 2026-10-28 · Plan: [PLAN.md](./PLAN.md) · Rama: `claude/gallant-thompson-wp8f28` (sin push)
- Peldaño de evidencia alcanzado: **TESTED** (tests dirigidos y type-check en verde; no hay `VERIFIED`: no se ejercitó contra Postgres ni por HTTP real). No es peldaño 6, así que no se declara "listo".
- Aclaración de marco: COBIT 5 es un marco de **gobierno**. Este documento entrega el mapeo hallazgo→proceso y la evidencia técnica; **no es una certificación ni una evaluación de capacidad de procesos**.

## Hallazgos

| ID | Sev. | Archivo:línea | CWE / OWASP 2025 | COBIT 5 | Estado |
|---|---|---|---|---|---|
| SEC-01 | Alta (condicionada) | `src/modules/sql-console/sql-console.constants.ts:137-160` (lista de funciones prohibidas); ejecución en `sql-console-query.service.ts:129` | CWE-863 / A01 Broken Access Control | DSS05.04 (acceso e identidad), DSS05.03 (endpoints/datos), APO13.01 | CORREGIDO (commit de esta rama) |
| SEC-02 | Media | `src/common/observability/metrics.controller.ts:49-60` | CWE-200 / A05 Misconfiguration | DSS05.02 (seguridad de red), APO13.02, DSS05.07 (monitoreo) | CORREGIDO (opcional: exige definir el token) |
| SEC-03 | Alta (DoS) | `package.json` `resolutions`, `yarn.lock` | CWE-1395, CWE-400 / A03 Supply chain | BAI06 (cambios), DSS05.01 (malware/vulnerabilidades), APO12 | CORREGIDO |
| SEC-04 | Media (solo dev) | `docker-compose.yml:290,312,328,357-358` | CWE-1327, CWE-1188 / A05 | DSS05.02, DSS05.03 | CORREGIDO |
| SEC-05 | Media/Alta (a confirmar) | `sql-console-query.service.ts:129-166` + `sql-console.controller.ts:30-32` | CWE-639 / A01 (aislamiento multi-tenant) | DSS05.04, DSS06 (controles de proceso), APO12 | NO CORREGIDO |

**SEC-01.** El guard de la consola SQL es una lista de denegación sobre palabras; el tokenizador no mira dentro de literales. `ts_stat('<sql>')`, `table_to_xml('iam.auth_credentials'::regclass,…)`, `schema_to_xml(...)`, etc. reciben el nombre de la tabla o la consulta como texto, así que evadían las listas de relaciones y de esquemas prohibidos. Con `DB_READ_ENABLED=false` (valor por defecto en `.env.example:78` y en ambos composes) la consola usa la conexión primaria con `SELECT` sobre todos los esquemas, de modo que un rol no revelador (`risk_analyst`, `compliance_analyst`, `readonly_auditor`) podía alcanzar tablas con credenciales o PII sin desidentificar. Se añadieron 19 funciones a la lista (xml de tabla/esquema/consulta/cursor, `ts_stat`, `pg_ls_*`, `pg_current_logfile`, `pg_notify`). Prueba: 9 casos nuevos fallaban sin el fix y pasan con él. **Riesgo residual:** sigue siendo una lista de denegación; la defensa estructural es `DB_READ_ENABLED=true` con el rol `atlas_app_ro`, que no tiene `SELECT` en esquemas de dominio (`src/database/apply-grants.ts:90-93`).

**SEC-02.** `GET /metrics` es `@Public()` y publica latencias y el mapa de rutas; la restricción dependía de configurar la red. Se añadió `METRICS_SCRAPE_TOKEN` (≥24 caracteres, `Authorization: Bearer`, comparación en tiempo constante). **Sin el token definido el comportamiento no cambia**: el hallazgo solo se cierra en cada despliegue cuando se define la variable y se actualiza el scrape de Prometheus. Un token corto rechaza todo (falla visible, no falsa protección).

**SEC-03.** `yarn audit --level high` (grupo producción) tenía 5 avisos altos y 6 moderados: `multer` (DoS por `fileFilter` asíncrono, <2.5.0), `body-parser` (<2.4.0), `zod` (agotamiento de memoria, <4.6.6), `qs` y `moment`. Se fijaron `resolutions` y se regeneró el lockfile (multer 2.5.0, body-parser 2.4.0, zod 4.6.7, qs 6.17.0, moment 2.31.0). Resultado: 0 vulnerabilidades en producción; en la auditoría completa quedan 2 de severidad baja (devDependencies).

**SEC-04.** El stack local publicaba Postgres (`atlas/atlas`), Redis y Mongo (sin autenticación) y MinIO en todas las interfaces. Ahora solo en `127.0.0.1`. No toca `API_PUBLISH_PORT`.

**SEC-05 (no corregido).** La consola SQL ejecuta SQL libre sobre `read_api` sin filtro por tenant (el cuaderno de datos sí acota por inquilino, `data-notebook-dataset.service.ts`). Si hay más de un tenant en la base, un rol de la consola de un tenant podría leer filas de otro. No se corrige porque no hay un cambio mínimo seguro: exige RLS o vistas por tenant, o limitar la consola a roles de plataforma. Es una decisión de diseño (ver Decisiones).

## Completado

| ID | Qué se logró | Comando | Resultado |
|---|---|---|---|
| H1.S1.M1-M6 | Exploración dirigida de secretos, auth/JWT, autorización, inyección/SSRF/uploads, CORS/webhooks/cripto/logs, Dockerfile/CI/dependencias | `git grep`, lectura de código, `yarn audit` | Hallazgos arriba; sin secretos reales commiteados |
| H2.S1.M1 | Dependencias instaladas | `yarn install --immutable` | `evidencia/yarn-install.txt` exit=0 |
| H2.S1.M2 | SEC-01 | `jest test/unit/sql-console` | 3 suites, 72 tests PASS (`evidencia/jest-sql-console.txt`); 9 fallaban antes del fix |
| H2.S1.M3 | SEC-02 | `jest test/unit/observability test/unit/sql-console` | 20 suites, 231 tests PASS (`evidencia/jest-dirigidos.txt`) |
| H2.S1.M4 | SEC-03 | `yarn audit --level high --groups dependencies` | 0 vulnerabilidades (`evidencia/yarn-audit-despues.txt`) |
| H2.S1.M5 | SEC-04 | `yarn check:env-example` | exit 0 (parsea ambos composes) |
| H2.S2.M1 | Tipos | `yarn type-check` y `yarn type-check:tests` | ambos exit 0 (`evidencia/typecheck.txt`) |
| H2.S2.M2 | Estilo y gates de repo | eslint + prettier sobre los 5 archivos TS tocados; `check:env-example`; `check:file-size`; `check:auth-coverage`; `check:tenant-header`; `check:no-env-file` | todos exit 0 (`evidencia/lint-format-checks.txt`, `gates-check-scripts.txt`) |
| H3.S1.M1-M2 | Reporte y commit local | `git show --stat HEAD` | ver commit de la rama |

## A medias

### H2.S1.M6 — SEC-05 consola SQL sin acotar por tenant
- Qué anda: el hallazgo está leído en código y documentado.
- Qué no anda: no hay acotado por tenant en `/sql-console/query`.
- Qué falta exactamente: decidir el modelo (RLS en `read_api`, vistas por tenant o restringir a roles de plataforma) y su prueba negativa entre tenants contra Postgres real.
- Dónde quedó: sin cambios de código; el repo compila.

### H2.S2.M3 — suite unitaria completa
- Qué anda: `yarn test:unit` → 804 de 806 suites y 8201 de 8202 tests PASS (`evidencia/jest-unit-completo.txt`), tras el cambio de multer/zod/qs/body-parser.
- Qué no anda: 2 suites fallan, clasificadas **ENVIRONMENT** (no atribuibles al cambio): `test/unit/ops/monitor-ruido.spec.ts` (no existe `ssh-keygen` en este entorno) y `test/unit/common/logging/app-file-logger-degrades.spec.ts` (el proceso corre como root, uid 0, y `chmod 0500` no impide escribir). Reproducción: `which ssh-keygen` vacío; `id -u` = 0. No se ejecutaron sobre el commit base para contrastarlas.
- Qué falta exactamente: correrlas con un usuario no root y con `openssh-client`.
- Dónde quedó: sin `skip` ni cambios en esos tests.

## Pendiente

| ID | Estado | Qué lo destraba |
|---|---|---|
| Rotación | Ninguna | No se encontraron secretos reales commiteados; nada que rotar. |
| Definir `METRICS_SCRAPE_TOKEN` en cada despliegue y el `authorization` de Prometheus | TODO (operación) | Equipo de plataforma |

## Evidencia
Índice de `docs/trabajo/2026-10-28-auditoria-cobit5-seguridad/evidencia/`: `yarn-install.txt`, `jest-sql-console.txt`, `jest-dirigidos.txt`, `jest-unit-completo.txt` (cola de 40 líneas), `typecheck.txt`, `lint-format-checks.txt`, `gates-check-scripts.txt`, `yarn-audit.txt`, `yarn-audit-resumen.txt`, `yarn-audit-despues.txt`.

```text
yarn audit --level high --groups dependencies
0 vulnerabilities found - Packages audited: 382
jest test/unit/sql-console test/unit/observability
Test Suites: 20 passed, 20 total · Tests: 231 passed, 231 total
yarn test:unit
Test Suites: 2 failed, 804 passed, 806 total · Tests: 1 failed, 8201 passed, 8202 total
```

## Controles revisados sin hallazgo (con archivo)
JWT HS256 fijo con `iss`/`aud` y `tokenVersion` obligatorio en producción (`jwt-auth.guard.ts`, `jwt-claims.util.ts`); cookies `HttpOnly`, `Secure` en producción, `SameSite=lax` por defecto (`auth-cookies.util.ts`, `env.ts`); `@Throttle` en login, PIN, reset y refresh, con degradación a límite en memoria si cae Redis (`redis-throttler-storage.ts`); webhooks con firma y comparación en tiempo constante (Twilio, SendGrid, Brevo, ERP, clave de callback del motor); `ErpMailSignatureGuard` sobre cuerpo crudo; SSRF acotado en el cliente de pruebas de sistemas (`systems-test-http-client.service.ts`); `LocalFileStorageAdapter` contra `../`; adjuntos con `Content-Disposition: attachment`; control de roles asignables en alta de usuarios internos; secretos de producción rechazados si son plantilla (`env-cross-checks.ts`); Dockerfile multi-stage con usuario `node`, sin `curl` ni npm; acciones de CI fijadas por SHA; `.env` no versionado (`check:no-env-file`).

## No cubierto
- Exploración muestreada, no exhaustiva: ~1.900 archivos `.ts`; el control de propiedad a nivel de objeto (BOLA) se revisó por muestreo (soporte, extractos, expedientes), no endpoint por endpoint.
- Sin Postgres/Redis/HTTP reales: las correcciones SEC-01 y SEC-02 están probadas a nivel unitario; no se probó la ejecución de las funciones SQL contra una base ni un scrape real con Prometheus.
- `yarn audit` consulta el registro público; no se ejecutó escaneo de imagen (Trivy), ni de secretos con gitleaks, ni se revisó el historial git completo (solo el árbol actual).
- Dockerfile: las imágenes se fijan por etiqueta, no por digest (hallazgo bajo, anotado, no corregido).
- Infraestructura real (proxy, red de scrape, KMS, valores de producción), `Dockerfile.dev`, el servidor de sonda del worker (`worker-probe-server.ts`, también expone `/metrics`) y las integraciones con proveedores externos.
- `.graphify/graph.json` no existe; no se usó graphify.
- Los procesos COBIT 5 (APO13, DSS05, DSS06, BAI06, APO12, MEA01-03) se citan como mapeo de los hallazgos; no se evaluó la capacidad de esos procesos en la organización (MEA01-03 queda fuera: requiere evidencia de gobierno que no está en el código).

## Desvíos del plan
- El hook `plan_gate` no existe en este repo (`.claude/hooks/` ausente); el `PLAN.md` se creó igual antes de editar código.
- Se añadieron SEC-02 a SEC-04 a H2 durante la ejecución (el plan solo preveía "fix por hallazgo").

## Riesgos residuales
- SEC-05 abierto (posible lectura entre tenants desde la consola SQL).
- SEC-01 mitiga con lista; defensa estructural pendiente de activar `DB_READ_ENABLED=true`.
- `/metrics` sigue público en cualquier despliegue que no defina el token.
- El bump de `multer` 2.4→2.5 y `qs` 6.16→6.17 se cubrió con la suite unitaria; no hay prueba de subida real multipart.
- La contraseña temporal de usuarios internos viaja por correo en claro (`internal-users.service.ts`, `sendInitialCredentials`), con `mustChangePassword`; anotado, fuera de alcance.
- El secreto del webhook de Brevo viaja en la ruta (`brevo-sms-events/:secreto`); el repo tiene redacción de rutas (`path-secret-redaction.util.ts`), pero queda en logs de proxies externos.

## Decisiones y ambigüedades
- Se decidió que `METRICS_SCRAPE_TOKEN` sea **opcional** para no romper el scrape existente; confirmar con plataforma si debe ser obligatorio en producción.
- SEC-05: ¿la consola SQL debe estar acotada por tenant o es una herramienta de plataforma? Confirmar con el responsable de seguridad/datos. Supuesto tomado: no corregir sin esa decisión.
- Los fallos de las 2 suites se clasificaron ENVIRONMENT por reproducción del entorno, sin correrlas en el commit base.
- Secretos a rotar: **ninguno** encontrado.
