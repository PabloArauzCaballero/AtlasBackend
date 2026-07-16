# Roles PostgreSQL de Atlas

Implementa la Fase 2 del plan de mejora del modelo de datos: privilegio mínimo con cuatro roles
diferenciados en vez de una sola identidad `DB_USER` con permisos amplios.

## Jerarquía

| Rol              | Login | Para qué sirve                                                        | Privilegios                                                   |
| ---------------- | :---: | -------------------------------------------------------------------- | ------------------------------------------------------------ |
| `atlas_owner`    |  No   | Propietario de schemas, tablas, secuencias, vistas y funciones.      | Owner. Nadie se conecta como owner.                          |
| `atlas_migrator` |  Sí   | Aplica migraciones y grants en el pipeline de despliegue.            | `LOGIN`, miembro de `atlas_owner` (puede `SET ROLE`). No runtime. |
| `atlas_app_rw`   |  Sí   | Runtime normal del backend.                                          | CRUD en tablas del core + USAGE/SELECT en secuencias. Sin DDL, sin TRUNCATE, sin ownership. |
| `atlas_app_ro`   |  Sí   | Lecturas puras: BI, dashboards, exportaciones, endpoints read-only.  | USAGE en `read_api` + SELECT solo en vistas curadas. Read-only por defecto. |

## Por qué así (y no otra cosa)

- **No conectar el backend como `postgres` ni como owner.** El blast radius de una inyección SQL o un
  bug queda acotado a CRUD sobre tablas conocidas.
- **Migraciones con un rol distinto al runtime.** `atlas_migrator` solo vive en el secret manager de
  CI/CD; el runtime nunca puede alterar el schema.
- **`atlas_app_ro` no lee tablas base.** Solo ve las vistas de `read_api`, que proyectan columnas
  explícitas y ocultan PII/secretos. Así se puede conectar BI sin exponer el modelo operativo.
- **Beneficio inicial = seguridad y gobierno, no rendimiento.** Si RW y RO apuntan al mismo primario,
  no hay menos CPU ni I/O. La ganancia de rendimiento llega cuando RO apunte a una réplica (§13.3).

## Camino rápido: crear los roles desde el ORM (`yarn db:roles:bootstrap`)

Para local/CI no hace falta psql ni un DBA: el script usa **Sequelize** (el mismo ORM del backend)
para crear los roles y aplicar los grants, de forma idempotente.

```bash
# Las contraseñas vienen de tu gestor de secretos; NUNCA se versionan.
export DB_APP_RW_PASSWORD='...'
export DB_APP_RO_PASSWORD='...'
export DB_MIGRATOR_PASSWORD='...'
yarn db:roles:bootstrap
yarn check:db-privileges   # verifica la matriz de forma no destructiva
```

Se conecta con `DB_ADMIN_USER`/`DB_ADMIN_PASSWORD` (cae a `DB_USER`). Esa identidad necesita
**CREATE ROLE**; si no lo tiene, el script lo dice y no toca nada — los roles son objetos de
**cluster** y muchos proveedores administrados restringen su creación.

Además de crear los roles, el script:

- **Adopta la propiedad** de las tablas/vistas/secuencias existentes hacia `atlas_owner`. Sin esto,
  `atlas_migrator` no puede alterar objetos creados antes por otro rol (PostgreSQL exige ser dueño o
  miembro del rol dueño) y las migraciones fallarían con *"debe ser dueño de la tabla"*.
- Ejecuta `ALTER ROLE atlas_migrator IN DATABASE <db> SET role TO atlas_owner`, de modo que todo lo
  que cree una migración quede propiedad de `atlas_owner` sin que cada migración recuerde hacer
  `SET ROLE`.
- Concede a `atlas_app_rw` los privilegios sobre tablas **futuras** (`ALTER DEFAULT PRIVILEGES`) para
  las tres identidades que pueden aplicar DDL, para que el runtime no se quede sin permisos tras la
  próxima migración.

### Por qué es un script y no una migración Sequelize

- Los roles son objetos de **cluster**, no de base: una migración (que es por-base) los crearía como
  efecto colateral fuera de su alcance, y re-aplicarla contra otra base del mismo cluster no tendría
  sentido.
- Requiere **CREATE ROLE**. En muchos proveedores administrados el usuario de despliegue no lo tiene:
  la migración fallaría y **rompería el deploy** en vez de degradar con un aviso.
- El `down()` tendría que hacer `DROP ROLE`, destructivo y peligroso si otra base del cluster usa los
  mismos roles.
- Las contraseñas tendrían que entrar por env de todos modos, así que no se gana nada.

## Aplicación alternativa con SQL (operado por DBA / Terraform)

Los roles existen a nivel de cluster; muchos proveedores administrados restringen su creación. Por
eso viven en `ops/postgres/*.sql` y los aplica infraestructura, no `db:migration:up` (§15). Las
contraseñas **nunca** se versionan: se pasan como variables psql desde el gestor de secretos.

```bash
# 1) Crear/actualizar roles (contraseñas desde el secret manager, opcionales).
psql "$ADMIN_DATABASE_URL" \
  -v atlas_migrator_password="$MIGRATOR_PW" \
  -v atlas_app_rw_password="$APP_RW_PW" \
  -v atlas_app_ro_password="$APP_RO_PW" \
  -f ops/postgres/bootstrap-roles.sql

# 2) Otorgar privilegios (como owner, o migrator con SET ROLE atlas_owner).
psql "$OWNER_DATABASE_URL" -v core_schema=public -v read_schema=read_api -f ops/postgres/grants.sql

# 3) Verificar (read-only).
psql "$DATABASE_URL" -v core_schema=public -v read_schema=read_api -f ops/postgres/verify-privileges.sql
```

Todos los scripts son idempotentes y re-ejecutables.

## Matriz de privilegios esperada

| Operación               | owner | migrator | app_rw          | app_ro          |
| ----------------------- | :---: | :------: | :-------------: | :-------------: |
| SELECT vista `read_api` |  Sí   |   Sí     | Sí              | Sí              |
| SELECT tabla operativa  |  Sí   |   Sí     | Sí              | **No** (default)|
| INSERT/UPDATE/DELETE    |  Sí   |   Sí     | Sí (según módulo)| **No**         |
| TRUNCATE                |  Sí   | Solo despliegue excepcional | **No** | **No** |
| CREATE / ALTER TABLE    |  Sí   | Vía owner | **No**         | **No**          |
| CREATE ROLE             |  No necesario | No | No          | No              |

## Relación con la configuración del backend

- Hoy el backend usa una sola identidad `DB_USER`/`DB_PASSWORD` (la conexión write/default). La
  recomendación es apuntarla a `atlas_app_rw`.
- Las migraciones (`db:migration:up`) deben correr con `atlas_migrator`, no con el usuario runtime.
- `atlas_app_ro` se usa primero para BI/consultas manuales. El segundo pool read-only dentro del
  backend (Fase 5) es opcional y gradual: variables `DB_READ_*` (ver `.env.example`).

## Verificación automatizada

`yarn check:db-privileges` (ver `scripts/check-db-privileges.ts`) conecta como `atlas_app_rw` y
`atlas_app_ro` (si hay credenciales en el entorno) y valida la matriz anterior de forma no
destructiva vía `has_table_privilege` / `has_schema_privilege`. Si no hay credenciales configuradas,
el script se salta con un aviso (no falla), para no bloquear entornos que aún no crearon los roles.

## No recomendado (§41)

- Conectar el backend como `postgres` u owner.
- Ejecutar migraciones con el mismo usuario runtime.
- Dar SELECT general de todas las tablas al usuario RO.
- Usar la conexión read-only en auth, outbox, idempotencia o riesgo transaccional.
- Guardar contraseñas de roles en SQL versionado.
