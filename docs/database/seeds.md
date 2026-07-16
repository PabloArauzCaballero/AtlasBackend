# Seeders por perfil — Proyecto Atlas

## Objetivo

Los seeders están separados **físicamente por perfil** para que los datos de arranque productivo
nunca se mezclen con clientes, usuarios y operaciones ficticias de desarrollo/demo. Esto implementa
la Fase 1 del plan de mejora del modelo de datos (rigidez selectiva + separación de perfiles).

| Perfil        | Directorio                          | Qué contiene                                                                                          |
| ------------- | ----------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `production`  | `src/database/seeders/production/`  | Solo datos de arranque: RBAC, catálogos, definiciones técnicas, baseline de riesgo. **Sin personas.** |
| `development` | `src/database/seeders/development/` | Tenant local, credenciales dev, usuario admin Pablo, cliente demo mínimo.                             |
| `demo`        | `src/database/seeders/demo/`        | Grafo demo rico: portal runtime, deep graph, gobierno, metadatos, mensajes y casos visuales.         |
| `test`        | `src/database/seeders/test/`        | Fixtures mínimos deterministas (tenant de prueba). Preferir factories dentro de cada test.            |

Los perfiles superiores **incluyen** a los inferiores en orden. El directorio `production` corre
primero en todos los perfiles porque los seeders demo/dev dependen de sus catálogos y baselines
(por ejemplo, el ruleset de riesgo `_id = 101`).

| Perfil ejecutado | Stages que corre (en orden)         |
| ---------------- | ----------------------------------- |
| `production`     | production                          |
| `development`    | production → development            |
| `demo`           | production → development → demo      |
| `test`           | production → test                   |

Cada directorio usa **su propia tabla de tracking** Umzug, de modo que un archivo movido entre
perfiles queda registrado sin ambigüedad:

```
SequelizeDataSeedersProduction
SequelizeDataSeedersDevelopment
SequelizeDataSeedersDemo
SequelizeDataSeedersTest
```

El directorio `production` siempre se rastrea en `SequelizeDataSeedersProduction`, sin importar qué
perfil lo dispare: así los seeders de arranque se aplican una sola vez por base.

## Comandos

```bash
# Arranque productivo (solo catálogos/baselines idempotentes)
yarn db:seed:prod

# Desarrollo (production + development)
yarn db:seed:dev

# Demo/staging rico (production + development + demo)
yarn db:seed:demo

# Test (production + test)
yarn db:seed:test

# Estado por perfil
yarn db:seed:status:prod
yarn db:seed:status:dev
yarn db:seed:status:demo
yarn db:seed:status:test

# Reseed (truncar + recargar) — NUNCA para production
yarn db:seed:reseed:dev
yarn db:seed:reseed:demo
yarn db:seed:reseed:test
```

`yarn db:seed:up|down|status|reseed` (sin sufijo) siguen existiendo por compatibilidad y resuelven el
perfil desde `SEED_PROFILE` o, en su defecto, desde `NODE_ENV` (production→production, test→test,
resto→development).

## Resolución de perfil y guards

1. Flag explícito: `--profile=production|development|demo|test`.
2. Variable de entorno `SEED_PROFILE`.
3. Default derivado de `NODE_ENV`.

Guards obligatorios (`src/database/seed-profiles.ts` + `src/database/seed.ts`):

- **`NODE_ENV=production` + perfil ≠ `production` → falla antes de conectar.** Ningún seeder demo/dev
  puede entrar a una base real.
- **`reseed` está prohibido para `production`.** Producción se corrige con seeders nuevos idempotentes
  o migraciones de datos, nunca truncando.
- **Gate de nombres:** ningún archivo de `production/` puede contener los tokens `demo`, `dev`,
  `fixture`, `mock`, `sample` (por segmento). Se verifica en runtime y en CI (`yarn check:seed-profiles`).
- **Gate de contenido (CI):** los seeders de `production/` no pueden contener marcadores de datos
  ficticios (hash `dev_seed_hash`, correos `.test`, hashes `$argon2` versionados).

El seeder de desarrollo `development/20260704121500-seed-pablo-admin-user.ts` además repite su propio
guard `NODE_ENV=production` como defensa en profundidad.

## Política de idempotencia productiva

Todo seeder de `production/` debe poder re-aplicarse sin duplicar filas ni violar constraints:

- Corre dentro de una transacción.
- Identifica registros por **clave natural estable** (`role_code`, `permission_code`, `feature_code`,
  `_id` fijo para baselines).
- Usa `INSERT ... ON CONFLICT ... DO UPDATE` o `UPDATE`-then-`INSERT-if-not-exists`.
- No borra datos operativos ni sobrescribe configuración aprobada manualmente.

## Seeders incluidos

### `production/`

| Seeder                                              | Qué carga                                                                                             |
| --------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `20260702032000-seed-external-data-providers`       | Registro de proveedores externos (SEGIP, InfoCenter, QR, banca, telco, WhatsApp, digital trust) + políticas de costo. |
| `20260703002000-seed-systems-ops-catalog`           | Catálogo técnico auto-documentado: endpoints, tablas, herramientas, impactos, suites, perfiles de stress. |
| `20260704121000-seed-internal-rbac`                 | Roles del sistema, permisos y matriz rol→permiso. **Sin usuario personal** (`created_by = NULL`).    |
| `20260706020000-seed-schema-constraint-notes`       | Notas técnicas de constraints del esquema (gobierno).                                                 |
| `20260706100000-seed-catalog-entries-v1-risk-income-zones` | Catálogos de riesgo, bandas de ingreso y zonas.                                                |
| `20260711085000-seed-risk-baseline-ruleset`         | Versión de modelo y ruleset base de riesgo (`atlas_bnpl_application_score` / `atlas_mvp_onboarding_ruleset`, `_id = 101`). Del que depende el baseline BNPL. |
| `20260711090000-seed-bnpl-production-risk-baseline` | Baseline idempotente de features y reglas BNPL. No contiene clientes ni operaciones ficticias.        |

### `development/`

| Seeder                                        | Qué carga                                                                    |
| --------------------------------------------- | ---------------------------------------------------------------------------- |
| `20260626160720-seed-minimal-dev-credentials` | Tenant local, usuarios base, cliente demo mínimo, dispositivo, sesión, etc.  |
| `20260704121500-seed-pablo-admin-user`        | Usuario admin `pablo@atlas.internal` (SUPER_ADMIN) + credenciales + roles. **Nunca en producción.** |

### `demo/`

| Seeder                                                         | Qué carga                                                                    |
| -------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `20260705090000-seed-portal-runtime-demo-data`                 | Grafo demo del portal: riesgo, calidad, notificaciones, outbox, jobs, health. |
| `20260705114000-seed-rich-systems-business-metadata`           | Metadatos de negocio ricos para el catálogo de sistemas.                     |
| `20260706000000-seed-deep-graph-demo-data`                     | Grafo profundo cliente/riesgo/fraude/contexto para pantallas ricas.          |
| `20260706010000-seed-external-provider-and-catalog-governance-demo-data` | Datos demo de gobierno de proveedores y catálogos.                 |

### `test/`

| Seeder                                    | Qué carga                        |
| ----------------------------------------- | -------------------------------- |
| `20260715000000-seed-test-baseline-fixtures` | Tenant de prueba (`_id = 1`). |

## Nota de adopción sobre bases existentes

El tracking pasó de una única tabla `SequelizeDataSeeders` a tablas por perfil. En una base ya
sembrada con el runner antiguo, las nuevas tablas empiezan vacías y el runner verá los seeders como
pendientes:

- Los seeders de `production/` son idempotentes: re-aplicarlos es seguro.
- Para `development`/`demo` sobre una base previa, corre `yarn db:seed:reseed:dev` (o `:demo`) una vez
  para reconstruir el entorno desde cero con el nuevo tracking.

## Alcance productivo BNPL

El baseline BNPL carga metadatos y políticas de referencia, no una calibración aprobada. Antes de
activar decisiones reales se deben validar localmente fuentes, calidad, umbrales y tratamiento de
datos con Riesgo y Cumplimiento. En particular, el umbral de servicio total de deuda `0.40` y los
umbrales de acumulación son parámetros conservadores de arranque para revisión manual; no son
límites regulatorios bolivianos.

## Variables ENV de limpieza

| Variable                          | Default | Uso                                                                                                                 |
| --------------------------------- | ------: | ------------------------------------------------------------------------------------------------------------------- |
| `SEED_PROFILE`                    |   vacío | Perfil por defecto cuando no se pasa `--profile`. Vacío → derivado de `NODE_ENV`.                                    |
| `DATABASE_CLEAN_BEFORE_SEED`      | `false` | Si está en `true`, ejecuta `TRUNCATE ... RESTART IDENTITY CASCADE` sobre las tablas de aplicación antes de sembrar. |
| `DATABASE_CLEAN_ALLOW_PRODUCTION` | `false` | Doble seguro para producción. Debe seguir en `false` en uso normal.                                                 |
| `DATABASE_CLEAN_CONFIRM`          |   vacío | En producción debe ser exactamente `ATLAS_DESTROY_SEED_DATA` además del flag anterior.                              |

No uses limpieza sobre una base real. Para desarrollo/staging desechable sí es la forma correcta de
garantizar una carga reproducible.

## Credencial local para el panel interno

El seeder `development/20260704121500-seed-pablo-admin-user` crea/actualiza el usuario
`pablo@atlas.internal` (ver `docs/database/dev-credentials.md`). Falla explícitamente si
`NODE_ENV=production`. La contraseña no se documenta en texto plano (ver ATLAS-P0-002 en
`docs/progress/remediation-register.md`); pídela al dueño de la cuenta.
