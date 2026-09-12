# Línea base ejecutable y base de pruebas aislada (AT-002)

Cómo se corre lo que el plan de preparación para microservicios exige medir con PostgreSQL de verdad, y qué
significa cada resultado. Complementa `test/README.md`; no lo sustituye.

## Dos corredores, a propósito

| Corredor | Configuración | Qué corre | Base |
|---|---|---|---|
| `yarn test` / `test:unit` / `test:e2e` / `test:coverage` | `jest.config.cjs` | `test/unit`, `test/e2e`, `test/architecture`, `test/contracts` | Ninguna (dobles) |
| `yarn test:integration` | `jest.integration.config.cjs` | `test/integration/**` | PostgreSQL migrado |

`jest.config.cjs` excluye `test/integration/` con `testPathIgnorePatterns`. Al pasar `--testPathIgnorePatterns` por línea
de comandos ese array se **sustituye**, no se amplía: si alguna vez hay que excluir algo más, repetir también
`/test/integration/`.

Las pruebas de integración corren **in-band**: comparten una base y miden carreras que ellas mismas provocan (dos
conexiones sobre la misma fila), no las que provocaría otro worker.

## La guarda de aislamiento

`test/support/isolated-database.guard.ts` se ejecuta antes de abrir la primera conexión. Exige:

- `ATLAS_TEST_DATABASE_ISOLATED=true` — decisión explícita de quien ejecuta; `NODE_ENV=test` no la sustituye porque lo fija
  el propio corredor (`test/setup-jest-env.cjs`).
- que `DB_NAME` contenga `test`, **o** que esté autorizado nominalmente con `ATLAS_TEST_DATABASE_NAME=<nombre>` (el caso del
  job de CI, cuya base desechable se llama `atlas`).
- que el nombre no sea productivo (`atlas_prod`, `production`…): ahí no vale ninguna autorización.

Sin base alcanzable la suite **falla** con la causa; sólo salta si se pide con `ATLAS_GATES_ALLOW_SKIP=true`, la misma
política que `scripts/gate-skip-policy.ts` (ATLAS-CI-002). CI no lo pide.

## Levantar la base local (una vez)

```sh
POSTGRES_PUBLISH_PORT=55433 REDIS_PUBLISH_PORT=6389 docker compose up -d postgres redis
docker compose exec -T postgres psql -U atlas -d atlas -c "CREATE DATABASE atlas_test OWNER atlas"
set -a; source .env; set +a
DB_NAME=atlas_test DB_ADMIN_USER=atlas DB_ADMIN_PASSWORD=atlas \
  DB_APP_RW_PASSWORD="$DB_PASSWORD" DB_APP_RO_PASSWORD="$DB_READ_PASSWORD" DB_MIGRATOR_PASSWORD="$DB_MIGRATION_PASSWORD" \
  yarn db:roles:bootstrap
DB_NAME=atlas_test yarn db:migration:up
```

`test/setup-jest-env.cjs` fija `DB_NAME=atlas_test` si no viene otro; host, puerto y credenciales salen del `.env`
(`dotenv` no pisa lo ya definido). El rol con el que se conecta es el de runtime (`atlas_app_rw`): las pruebas miden lo
que la aplicación puede hacer, no lo que puede hacer un superusuario.

## Correr

```sh
ATLAS_TEST_DATABASE_ISOLATED=true yarn test:integration
```

En CI el paso «Integration tests against real Postgres» del job de base de datos corre después de `db:migration:up`
con `ATLAS_TEST_DATABASE_ISOLATED=true` y `ATLAS_TEST_DATABASE_NAME=atlas`.

## Cómo leer un resultado

- **PASS**: la propiedad se midió contra PostgreSQL.
- **FAIL**: la propiedad no se cumple, o la base no responde y nadie pidió el salto. Las dos son rojo; el mensaje distingue.
- **skip explícito** (`[skip] integración: …`): sólo aparece con `ATLAS_GATES_ALLOW_SKIP=true`. No es evidencia de nada.
- **NOT_RUN**: la suite no llegó a ejecutarse (por ejemplo, la guarda de aislamiento rechazó la base). Tampoco es evidencia.

## Línea base medida (2026-09-11, dev@5650b95)

| Comando | Resultado |
|---|---|
| `yarn install --frozen-lockfile` | rc=0 |
| `yarn type-check` / `type-check:tests` | rc=0 / rc=0 |
| `yarn lint` / `format:check` | rc=0 / rc=0 |
| `yarn test:unit` | 470 suites, 4945 pruebas, rc=0 |
| `yarn test:e2e` | 12 suites, 366 pruebas, rc=0 |
| `yarn docs:openapi` (arranca Nest) / `check:openapi` / `docs:openapi:lint` | rc=0 / rc=0 / rc=0 |
| `yarn check:migrations` / `check:domain-schemas` / `check:file-size` / `check:nest-entrypoints` | rc=0 |
| `yarn db:migration:status` (atlas_test) | 121 aplicadas, 0 pendientes |
| `yarn test:integration` | 5 suites, 26 pruebas, rc=0 |

Ninguna prueba heredada quedó en rojo antes ni después de los cambios de F1. Los registros están en el expediente de la
sesión (`scratchpad/baseline`, `scratchpad/regresion1`); el commit que integra F0/F1 vuelve a ejecutar la batería completa.
