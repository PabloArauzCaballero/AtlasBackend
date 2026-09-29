# Migraciones y seeds

Migraciones versionadas con Umzug 3 (el número actual está en
[Cifras reales](../architecture/index.md), que comprueba un gate) y semillas que ya **no** son código
del repositorio: se traen de una base aparte.

---

## Migraciones

### Reglas

| Regla | Por qué |
|---|---|
| Nunca `sync({ force })` ni `sync({ alter })` | `synchronize: false` y `autoLoadModels: false` son obligatorios. El esquema sólo cambia por migración |
| Toda migración tiene `up` **y** `down` | Sin `down`, un despliegue fallido no se puede revertir |
| Ninguna operación destructiva dentro de un `up` | Un `up` que borra datos no se puede deshacer con un `down` |
| Cambios destructivos por expand/contract | Añadir de forma idempotente (`IF NOT EXISTS`, `to_regclass`), backfill, y sólo entonces endurecer (`SET NOT NULL`) |
| DDL con `atlas_migrator`, nunca con el rol de runtime | Un runtime con DDL convierte cualquier inyección en un cambio de esquema |

### El gate

`yarn check:migrations` corre **sin base de datos** y bloquea en el PR:

- Colisión de tabla no idempotente entre dos migraciones.
- Prefijo de timestamp repetido sin excepción documentada.
- Migración sin `down`.
- Nombre fuera del patrón.

!!! danger "Por qué existe este gate"
    Una migración monolítica duplicaba las mismas 86 tablas que el split `schema-part-0..9` y
    compartía prefijo de timestamp con la primera. Umzug ordena alfabéticamente, así que el monolito
    ganaba y `yarn db:migration:up` sobre una base vacía abortaba en la segunda migración:
    **provisionar un entorno nuevo era imposible**. Se dio por eliminada una vez y reapareció. El
    gate es lo que impide que vuelva a pasar. Ver
    [migration-split-verification.md](../architecture/migration-split-verification.md).

### Ejecución

```bash
yarn db:migration:up        # aplicar pendientes
yarn db:migration:status    # ver aplicadas y pendientes
yarn db:migration:down      # revertir la última
```

Desde la imagen de producción, el mismo runner compilado:

```bash
node dist/src/database/migrate.js up
```

!!! info "Por qué el runner resuelve su propia ruta"
    El glob se resuelve desde `__dirname` con la extensión que corresponda al entorno: `.ts` con
    `tsx`, `.js` en el build compilado. Antes era la ruta literal `src/database/migrations/*.ts`, que
    apuntaba a fuentes TypeScript que la imagen **no puede importar** —`tsx` es devDependency y no
    viaja en ella—, así que correr las migraciones como job de despliegue era imposible
    (ATLAS-DEPLOY-001). El nombre registrado en `SequelizeMeta` sigue siendo `.ts`, para que una
    migración aplicada por CLI no se repita al correr el runner compilado.

---

## Seeds

Los seeders versionados por perfil (`production`/`development`/`demo`/`test`) y sus comandos
(`db:seed:up|down|dev|prod|reseed:dev`, `db:seed:verify-prod-idempotency`, `check:seed-profiles`) **ya
no existen**. Hoy hay dos fuentes de datos, y ninguna depende de un argumento `--profile`:

### 1. La base de semillas (dato maestro y, en desarrollo, usuarios de prueba)

El conjunto ya materializado vive en una base aparte y se trae con un comando. Qué base es —la de
desarrollo trae también usuarios y comercios de prueba; la de producción sólo dato maestro— lo decide
`SEED_SOURCE_DATABASE_URL` o `SEED_SOURCE_HOST` + `SEED_SOURCE_DB` + `SEED_SOURCE_USER` +
`SEED_SOURCE_PASSWORD`. Detalle en [Semillas](../database/seeds.md).

```bash
yarn db:seed:pull             # trae lo publicado. DESTRUCTIVO sobre las tablas del manifiesto
yarn db:seed:pull --if-empty  # igual, pero no hace nada si la base ya trajo una carga
yarn db:seed:status           # compara lo publicado con lo que hay aquí, sin escribir
```

### 2. La siembra demostrativa del repositorio

`src/database/seeders/demo/` define un conjunto propio, con upserts por identificador dentro del bloque
reservado 900000+. Correrla dos veces deja el mismo estado y no vacía ninguna tabla.

```bash
yarn db:seed:demo                        # escribe o actualiza el conjunto completo
yarn db:seed:demo --fundamental          # sólo configuración (colas, catálogos, políticas), sin pisar filas
yarn db:seed:demo --dry-run              # imprime qué escribiría
yarn db:seed:demo --solo ecosistema,soporte  # sólo esos dominios
```

La parte fundamental corre en cada despliegue (job `migrate` de `docker-compose.coolify.yml`); la
completa sólo con `DEMO_SEED_ENABLED=true`.

### Gates y comprobaciones

| Comando | Qué comprueba |
|---|---|
| `yarn check:seed-references` | Que la siembra demostrativa no lleve identificadores numéricos de otra base en columnas que apuntan fuera de lo que ella misma crea (se resuelven por clave natural con `refA`). |
| `yarn db:seed:verify-graph` | Consulta una base ya sembrada y falla si una relación padre → hijo del cliente de demostración quedó sin filas. |

!!! warning "Ids literales entre bases: la trampa"
    Una fila exportada de una base lleva el `_id` que su referencia tenía ALLÍ; en cualquier otra base
    ese número es otro o no existe. Entre el 2026-09-17 y el 18 cuatro despliegues murieron por esa
    causa con cuatro claves foráneas distintas. Por eso `check:seed-references` existe, y por eso
    antes, con los seeders por perfil, dos seeders de producción que apuntaban a políticas de retención
    por id literal impedían provisionar desde cero (ATLAS-DEPLOY-004).

### Siembra automática al arrancar

`DATABASE_SEED_ON_STARTUP=true` hace, al arrancar, lo mismo que `yarn db:seed:pull --if-empty`: trae el
conjunto sólo si la base aún no lo trajo. Corre **sólo en el proceso que ejecuta trabajo de fondo**
(`worker` o `all`): sembrar es mutar, y con N réplicas de API sería una carrera. Sin `SEED_SOURCE_*`
no hace nada. Ver [Variables de entorno](../config/environment.md).

El camino recomendado en despliegue sigue siendo el job one-shot `migrate` del compose, que termina
antes de que la API y el worker arranquen.
