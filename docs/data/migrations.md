# Migraciones y seeds

**61 migraciones** con Umzug 3, todas reversibles, y seeders repartidos en cuatro perfiles.

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

### Perfiles

| Perfil | Contiene | Cuándo |
|---|---|---|
| `production` | **Sólo catálogos de referencia.** Nunca datos ficticios | Todo despliegue |
| `development` | Credenciales mínimas y datos para trabajar en local | Desarrollo |
| `demo` | Grafo completo de un cliente de demostración | Demos |
| `test` | Fixtures deterministas | Pruebas |

`yarn check:seed-profiles` rechaza cualquier seeder del directorio `production/` cuyo nombre contenga
`demo`, `dev`, `fixture`, `mock` o `sample`. Es defensa en profundidad: el guard de arranque
(`assertProductionStageIsClean`) vuelve a comprobarlo en ejecución.

### Ejecución

```bash
yarn db:seed:prod           # sólo catálogos de referencia
yarn db:seed:dev            # + datos de desarrollo
yarn db:seed:demo           # + el grafo de demostración
yarn db:seed:reseed:dev     # trunca y recarga (PROHIBIDO en production)
```

### Idempotencia

Los seeders de producción deben poder correr dos veces sin cambiar nada. Lo verifica
`yarn db:seed:verify-prod-idempotency`.

!!! warning "Ids literales entre perfiles: la trampa"
    Dos seeders de producción referenciaban políticas de retención por **id numérico literal**
    (`1` y `102`). Esas filas sólo las crea el perfil `development`/`demo`, así que sobre una base
    vacía con el perfil `production` la clave foránea reventaba y **provisionar un entorno productivo
    era imposible**. Peor aún: en desarrollo sí existían, y los nueve proveedores quedaban atados en
    silencio a una política etiquetada `dev_testing_only`.

    Ambos seeders resuelven ahora **por código** (`policy_code`) y crean su propia entrada de
    catálogo. Registrado como ATLAS-DEPLOY-004.

    La regla general: **un id numérico compartido entre seeders de perfiles distintos es una
    dependencia invisible** que sólo falla al provisionar desde cero.

### Seeding automático al arrancar

`DATABASE_SEED_ON_STARTUP=true` aplica los seeders pendientes del perfil al arrancar, de forma
idempotente. Corre **sólo en el proceso que ejecuta trabajo de fondo** (`worker` o `all`): sembrar es
mutar, y con N réplicas de API sería una carrera.

El camino recomendado en producción sigue siendo el job one-shot `migrate` del compose, que termina
antes de que la API y el worker arranquen.
