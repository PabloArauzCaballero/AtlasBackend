# Arranque, migraciones y siembra por capacidad (AT-023)

Prueba: `test/integration/architecture/startup-without-ddl.spec.ts`. Regla: **el runtime normal nunca necesita DDL**;
migraciones y siembra de referencia son trabajos explícitos, idempotentes y con rol separado.

## Lo que ya cumple el repositorio (verificado)

| Garantía | Cómo | Evidencia |
|---|---|---|
| El ORM no crea ni altera tablas | `autoLoadModels: false`, `synchronize: false` en runtime y migrador (`database.config.ts`) | prueba de opciones; `check:domain-schemas` |
| El rol runtime no puede hacer DDL | `atlas_app_rw` sin CREATE en ningún schema; roles de contexto igual | `CREATE/ALTER` → `permission denied` desde la conexión real |
| Migraciones con rol propio | `atlas_migrator` (`DB_MIGRATION_USER`), `db:migration:up` / job `migrate` de Coolify | `SequelizeMeta` sólo legible por el migrador |
| Dos réplicas no migran a la vez | Umzug con `SequelizeStorage`: el job `migrate` es de un solo disparo y corre **antes** de las réplicas, no dentro de ellas | `docker-compose.coolify.yml` (`migrate` → `api`/`worker`) |
| La siembra no es del proceso HTTP | `StartupSeedService` sale si `!DATABASE_SEED_ON_STARTUP`, si `APP_ROLE=api` (`runsBackgroundWork()` falso) o sin `SEED_SOURCE_*`; N réplicas de API no siembran | prueba de `runsBackgroundWork()`; comentario en `worker.ts` |
| Perfiles de siembra preservados | `SEED_PROFILE` (`production|development|demo|test`) con guardas anti-producción | `seed.ts` |

## Procedimiento por capacidad (lo que un ejecutable extraído hace y no hace)

1. **Bootstrap de esquema** (una vez por base, rol migrador): `db:migration:up`. Nunca desde el runtime.
2. **Roles** (una vez, superusuario/owner): `ops/postgres/bootstrap-roles.sql`, `grants.sql`, `context-roles.sql`.
3. **Siembra de referencia** (opcional, rol migrador, proceso de fondo): `db:seed:pull`. Un piloto (Mensajería) no
   siembra dominios ajenos: su `SEED_PROFILE` sólo carga plantillas y políticas de mensajería o nada.
4. **Arranque del runtime** (rol de contexto o `atlas_app_rw`): sin DDL, sin siembra, sin `sync`. Si falta una
   migración, el runtime **falla en la primera consulta** que la necesite; no la aplica.

## Lo que cambia para el piloto (F7/F9)

- El ejecutable de Mensajería arranca con `APP_ROLE=api` o con su rol propio y `DATABASE_SEED_ON_STARTUP` sin
  efecto (no es proceso de fondo del monolito).
- Su `migrate` es un job aparte sobre su base, con el mismo runner (`migrate.ts`) apuntando a su carpeta de migraciones
  cuando se separe (AT-057).
- `worker.ts` conserva la siembra global sólo para el monolito; una raíz nueva (`WorkerModule` por capacidad, AT-045)
  no importa `StartupSeedService` salvo que la capacidad lo declare.

## Escenario «dos réplicas arrancan»

No hay carrera de migraciones porque ninguna réplica migra; la siembra la hace sólo el proceso con trabajo de fondo,
y `pullIfEmpty` es idempotente (`--if-empty`). Si se desplegaran dos workers, la siembra tendría que serializarse con
un bloqueo consultivo (`pg_advisory_lock`) — anotado para AT-045; hoy hay un único worker.
