-- ============================================================================
-- Atlas · Grants de privilegio mínimo (Fase 2 del plan de mejora del modelo de datos)
-- ============================================================================
--
-- Se aplica DESPUÉS de ops/postgres/bootstrap-roles.sql, como owner de los objetos
-- (o como atlas_migrator con `SET ROLE atlas_owner`).
--
-- Modelo:
--   atlas_app_rw -> USAGE en el schema core + CRUD en tablas + USAGE/SELECT en secuencias. Sin DDL.
--   atlas_app_ro -> USAGE en read_api + SELECT solo en vistas curadas. Sin acceso general a tablas base.
--
-- Uso:
--   psql "$OWNER_DATABASE_URL" \
--     -v core_schema=public \
--     -v read_schema=read_api \
--     -f ops/postgres/grants.sql
--
-- Idempotente: GRANT/REVOKE y ALTER DEFAULT PRIVILEGES se pueden re-ejecutar sin efecto acumulativo.
-- ============================================================================

\set ON_ERROR_STOP on

-- Defaults si no se pasan por -v.
\if :{?core_schema}
\else
  \set core_schema 'public'
\endif
\if :{?read_schema}
\else
  \set read_schema 'read_api'
\endif

-- ---------------------------------------------------------------------------
-- Asegurar que exista el schema de lectura (la migración también lo crea; aquí es defensivo).
-- ---------------------------------------------------------------------------
CREATE SCHEMA IF NOT EXISTS :"read_schema" AUTHORIZATION atlas_owner;

-- ---------------------------------------------------------------------------
-- Conexión a la base.
-- ---------------------------------------------------------------------------
GRANT CONNECT ON DATABASE :"DBNAME" TO atlas_app_rw, atlas_app_ro, atlas_migrator;

-- ---------------------------------------------------------------------------
-- Schema core (escritura): atlas_app_rw
-- ---------------------------------------------------------------------------
GRANT USAGE ON SCHEMA :"core_schema" TO atlas_app_rw;

-- Sin DDL para el runtime: nadie fuera del owner puede crear objetos en el schema core.
REVOKE CREATE ON SCHEMA :"core_schema" FROM atlas_app_rw;
REVOKE CREATE ON SCHEMA :"core_schema" FROM PUBLIC;

GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA :"core_schema" TO atlas_app_rw;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA :"core_schema" TO atlas_app_rw;

-- Tablas/secuencias FUTURAS creadas por el owner: mismos privilegios automáticamente.
ALTER DEFAULT PRIVILEGES FOR ROLE atlas_owner IN SCHEMA :"core_schema"
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO atlas_app_rw;
ALTER DEFAULT PRIVILEGES FOR ROLE atlas_owner IN SCHEMA :"core_schema"
  GRANT USAGE, SELECT ON SEQUENCES TO atlas_app_rw;

-- El runtime NO debe truncar ni tener ownership: no se otorga TRUNCATE ni se transfiere ownership.
-- atlas_app_ro NO recibe acceso general al schema core (lee exclusivamente vistas de read_api).

-- ---------------------------------------------------------------------------
-- Schema read_api (lectura): atlas_app_ro (y atlas_app_rw para que el backend lea vistas)
-- ---------------------------------------------------------------------------
GRANT USAGE ON SCHEMA :"read_schema" TO atlas_app_ro, atlas_app_rw;

GRANT SELECT ON ALL TABLES IN SCHEMA :"read_schema" TO atlas_app_ro, atlas_app_rw;

-- Vistas FUTURAS creadas por el owner en read_api: SELECT automático.
ALTER DEFAULT PRIVILEGES FOR ROLE atlas_owner IN SCHEMA :"read_schema"
  GRANT SELECT ON TABLES TO atlas_app_ro, atlas_app_rw;

-- Defensa explícita: el rol read-only nunca escribe, ni en las vistas.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON ALL TABLES IN SCHEMA :"read_schema" FROM atlas_app_ro;
ALTER DEFAULT PRIVILEGES FOR ROLE atlas_owner IN SCHEMA :"read_schema"
  REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLES FROM atlas_app_ro;

\echo 'Grants aplicados: atlas_app_rw (CRUD en core, sin DDL), atlas_app_ro (SELECT solo en read_api).'
