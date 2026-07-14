# Registro de remediación — AtlasBackend

Fuente de verdad de hallazgos abiertos del `PLAN_ACCION_ATLAS_BACKEND_10_10.md`. Solo se listan
paquetes evaluados contra el código real (no se asume nada del plan sin verificarlo primero).

Estados: `OPEN` · `IN_PROGRESS` · `CODE_COMPLETE` · `VERIFIED_LOCAL` · `VERIFIED_CI` · `CLOSED` · `ACCEPTED_RISK` · `DEFERRED`

| ID | Severidad | Área | Estado | Archivos | Evidencia |
|---|---|---|---|---|---|
| ATLAS-P0-003 | Crítica | Secretos en artefactos | CLOSED | `scripts/smoke/http.ts`, `.gitignore` | `smoke-results.json` desligado de git (`git rm --cached`), redacción por clave (`password`, `accessToken`, `refreshToken`, etc.) y por patrón JWT agregada en `writeSmokeResults()`. Verificado con script de sanidad ad-hoc (ver historial de conversación); `tsc --noEmit` y `eslint` limpios. |
| ATLAS-P0-001 | Crítica | Seed de admin en producción | CLOSED | `src/database/seeders/20260704121000-seed-internal-rbac-and-pablo.ts` | `up()` ahora lanza `Error` de inmediato si `env.NODE_ENV === 'production'`, antes de abrir la transacción. `db:migration:status`/`db:seed:status` no se ven afectados; solo bloquea la ejecución real del seeder. |
| ATLAS-P0-002 | Crítica | Credencial admin hardcodeada | CLOSED | mismo seeder que ATLAS-P0-001, `docs/database/dev-credentials.md`, `docs/database/seeds.md`, `.env.example`, `scripts/smoke/internal-rbac.smoke.ts`, `scripts/smoke/frontend-contract.smoke.ts`, `src/modules/systems-ops/systems-seed-fixtures.ts` | Hash Argon2id anterior (`OXSNkeaFiWk4isxmbnnDSPC...`) tratado como comprometido permanentemente por estar en el historial de git — rotado a un hash nuevo generado con `hashPassword()`. La contraseña en texto plano vieja (`Atlas_Pablo#2026!`) se eliminó de toda la documentación versionada (no se reemplazó por la nueva en texto plano en ningún doc). Los smoke scripts que hacían login real como `pablo` (dependencia funcional real, no solo doc) se actualizaron para usar la nueva contraseña como fallback, igual que el patrón ya existente de `INTERNAL_SMOKE_QA_PASSWORD`. `systems-seed-fixtures.ts` tenía la credencial real filtrada en un `minPayloadSchema` de ejemplo — se corrigió a un placeholder genérico (`'string\|required'`), igual que su fixture hermana `POST_AUTH_LOGIN`. **Aplicado a la base local de desarrollo**: se confirmó vía `db:seed:status` que el seeder ya estaba en `executed` (base sembrada antes de esta rotación). Se corrió un `UPDATE` de un solo uso, dirigido (`WHERE actor_type = 'internal_user' AND actor_id = 1`), que fijó el hash nuevo, incrementó `token_version` (invalida cualquier access token viejo emitido con la contraseña anterior, mismo mecanismo que `logout allDevices`) y limpió `failed_login_attempts`/`locked_until`. `rowCount: 1` confirmado. El script de un solo uso se borró después de ejecutarse; no quedó persistido en el repo. |
| ATLAS-P0-004 | Alta | Rotación de refresh token no atómica | OPEN | `src/modules/auth/auth.service.ts` (método `refresh`, líneas ~171-210), `src/modules/auth/auth.repository.ts` | Confirmado en código: `refresh()` lee, valida y rota el refresh token sin transacción ni `FOR UPDATE`. Condición de carrera real ante dos refresh concurrentes con el mismo token. No iniciado — pendiente de confirmación de scope para arrancar.

## Hallazgos del plan ya cerrados antes de este registro (verificado, no requieren trabajo)

- CI (Fase 9): ya existe `.github/workflows/ci.yml` con install → check-env → lint → format → type-check → test+coverage → build, más un job separado con Postgres/Redis reales corriendo migraciones + seeders + smoke en cada PR, más `dependency-audit` (`yarn audit --level high`) y un check de tamaño de migraciones.
- RBAC granular (Fase 3): ya existe `@InternalPermissions`/`InternalPermissionsGuard` (~45 permisos) para `internal-users`; el trabajo pendiente es *extender* cobertura a otros módulos incrementalmente, no crearlo desde cero. Primer paso ya dado: `catalog-management` — endpoints `decision` y `activate` restringidos a `admin`/`platform_admin` (ver commit de esta sesión).

## Fases del plan evaluadas como prematuras o que requieren decisión de infraestructura (no iniciar sin confirmación explícita)

Fases 6 (workers separados), 10 (observabilidad Pino/métricas), 11 (contenedores/backups/despliegue) —
requieren visibilidad sobre el entorno de despliegue real que no está disponible solo desde el
código. No iniciar sin que el usuario confirme la topología de infraestructura actual.
