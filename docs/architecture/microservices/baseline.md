# Línea base de la preparación para microservicios (AT-001)

**Repositorio:** `PabloArauzCaballero/AtlasBackend`. **Rama de trabajo:** `dev`. **Commit base de esta ejecución:**
`5650b95fcd45d41a817894e3827414ba706c81e3` (2026-09-10). **Fecha:** 2026-09-11.

El plan (`AtlasBackend_Plan_SOLID_Microservicios`, fuera de este repositorio) se elaboró contra
`670e9b21d77aad8768ff413ac025354e7832ed15`, que es donde sigue `origin/main`. `dev` va **379 commits y 1.763 archivos**
por delante; el plan se revisó y corrigió contra este HEAD antes de tocar código (sección «Vigencia de los hallazgos» de
`FUENTES_Y_ALCANCE.md` del paquete). Este baseline no afirma que el plan describa el código sin cambios: describe lo que
se comprobó.

## Versiones efectivamente resueltas

| Pieza | Fijada | Resuelta (`yarn.lock` / entorno) |
|---|---|---|
| Node | `.nvmrc` 22.16.0, `engines >=22.0.0` | 22.23.2 (`/opt/homebrew/opt/node@22`; el `node` por defecto del PATH es v24 y rompe `engines`) |
| Yarn | `packageManager yarn@1.22.22` | 1.22.22 |
| NestJS | `^11` | `@nestjs/core` 11.2.3 |
| Sequelize / sequelize-typescript | `^6` / `^2` | 6.37.8 / 2.1.6 |
| PostgreSQL | `docker-compose.yml` postgres:16 | 16 (contenedor `atlasbackend-postgres-1`, puerto publicado 55433) |
| TypeScript / ts-jest / jest | — | 5.9.3 / 29.4.12 / 30.4.2 |
| umzug / pg / zod / eslint / tsx | — | 3.8.3 / 8.23.0 / 4.4.3 / 10.9.0 / 4.23.12 |

`node_modules` no existía en este checkout: `yarn install --frozen-lockfile` (rc=0) es parte de la línea base.

## Instrucciones del repositorio leídas y respetadas

`CLAUDE.md`, `.claude/CLAUDE.md`, `.claude/rules/10-typescript-backend.md`, `30-security.md`, `60-testing.md`,
`80-database.md`. No se sobrescribió ninguna. Precedencia declarada: `docs/audit/` > código y pruebas > `docs/`.

## Comandos disponibles y estado al arrancar

Ver `docs/testing/microservices-baseline.md`, tabla «Línea base medida»: los diez gates locales y las suites unitaria y
e2e estaban en verde **antes** de cualquier cambio; `db:migration:status` sobre la base local de desarrollo marcaba 2
migraciones pendientes (no aplicadas por esta ejecución: no es su base), y sobre `atlas_test` quedaron 121/0 tras migrar.

## Módulos: 41, no 26

`src/modules` tiene 41 módulos (`support` 50 archivos, `customer-onboarding` 45, `external-data` 37…). Quince no
existían en el commit del plan: `app-content`, `credit-rating`, `customer-device-signals`, `data-notebook`,
`decision-engine`, `expedientes`, `loan-payment-claims`, `loans`, `merchant-identity`, `mobile-identity`,
`mobile-welcome-audio`, `partner-onboarding`, `runtime-hardening`, `sql-console`, `support`. Su contexto y propietario
están en `context-map.json` (AT-063) y los valida `test/architecture/context-map.spec.ts`.

## Alcance de lo que esta ejecución cambió

| Tarea | Archivos de negocio tocados | Documentos y pruebas creados |
|---|---|---|
| AT-001 | ninguno | `baseline.md`, `source-inventory.json` |
| AT-002 | `package.json`, `jest.config.cjs`, `.github/workflows/ci.yml` | `jest.integration.config.cjs`, `test/support/isolated-database.guard.ts` (+spec), `test/integration/support/database.ts`, `docs/testing/microservices-baseline.md` |
| AT-003 | ninguno | `scripts/architecture/inventory-imports.ts` (+spec), `import-baseline.json` |
| AT-004 | ninguno | `scripts/architecture/inventory-database.ts` (+spec de integración), `data-ownership.json`, `transaction-map.md` |
| AT-005 | ninguno | `http-compatibility.md` (huella del contrato OpenAPI congelado) |
| AT-063 | ninguno | `context-map.json` (+spec) |
| AT-006/007/008 | `credit-application-admission.service.ts`, `customer-eligibility.service.ts` | 3 suites de integración, `admission-consistency.md` |
| AT-009/010 | `runtime-hardening.service.ts`, `idempotency.interceptor.ts`, `runtime-hardening.module.ts`, modelo y migración `owner_token`, `env.schema.ts`, `.env.example` | `infrastructure/idempotency-claim.store.ts`, `application/idempotency-policy.ts`, suite de integración de carrera, contrato de política |

Los archivos «desconocidos» del plan (rutas propuestas que no existían) se crearon donde el plan los pedía; los archivos
que el plan citaba y que se habían movido (`credit-application.service.ts` → `credit-application-admission.service.ts`)
se corrigieron en el paquete antes de editar.

## Variables sensibles

El reporte no contiene valores. Las variables presentes en `.env` cuyo NOMBRE importa para esta ejecución: `DB_HOST`,
`DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD`, `DB_MIGRATION_USER`, `DB_MIGRATION_PASSWORD`, `DB_READ_USER`,
`DB_READ_PASSWORD`, `JWT_ACCESS_TOKEN_SECRET`. Nueva y opcional: `IDEMPOTENCY_FINGERPRINT_SECRET` (vacía = derivada).
