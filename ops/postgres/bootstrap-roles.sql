-- ============================================================================
-- Atlas · Bootstrap de roles PostgreSQL (Fase 2 del plan de mejora del modelo de datos)
-- ============================================================================
--
-- Crea la jerarquía de roles de privilegio mínimo:
--
--   atlas_owner     -> propietario de objetos, SIN LOGIN. Nadie se conecta como owner.
--   atlas_migrator  -> aplica migraciones/grants en el pipeline. Puede SET ROLE atlas_owner.
--   atlas_app_rw    -> runtime normal del backend (SELECT/INSERT/UPDATE/DELETE, sin DDL).
--   atlas_app_ro    -> lecturas puras / reporting (read-only por defecto, solo vistas curadas).
--
-- Los roles existen a nivel de CLUSTER; muchos proveedores administrados restringen su creación.
-- Este archivo lo ejecuta Terraform / un job de bootstrap operado por DBA, NO las migraciones de
-- aplicación (§15). Las contraseñas NUNCA se versionan: se pasan como variables psql en el momento
-- de aplicar, desde el gestor de secretos.
--
-- Uso:
--   psql "$ADMIN_DATABASE_URL" \
--     -v atlas_migrator_password="$MIGRATOR_PW" \
--     -v atlas_app_rw_password="$APP_RW_PW" \
--     -v atlas_app_ro_password="$APP_RO_PW" \
--     -f ops/postgres/bootstrap-roles.sql
--
-- Si se omite una variable de contraseña, el rol se crea/actualiza sin tocar su contraseña (útil
-- cuando el proveedor gestiona la autenticación por otro canal). Es idempotente: puede re-ejecutarse.
-- ============================================================================

\set ON_ERROR_STOP on

-- ---------------------------------------------------------------------------
-- atlas_owner (NOLOGIN)
-- ---------------------------------------------------------------------------
SELECT NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'atlas_owner') AS create_atlas_owner \gset
\if :create_atlas_owner
  CREATE ROLE atlas_owner;
\endif
ALTER ROLE atlas_owner WITH NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;

-- ---------------------------------------------------------------------------
-- atlas_migrator (LOGIN, despliegue). Puede asumir el owner para DDL.
-- ---------------------------------------------------------------------------
SELECT NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'atlas_migrator') AS create_atlas_migrator \gset
\if :create_atlas_migrator
  CREATE ROLE atlas_migrator LOGIN;
\endif
ALTER ROLE atlas_migrator WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS CONNECTION LIMIT 3;
GRANT atlas_owner TO atlas_migrator;
\if :{?atlas_migrator_password}
  ALTER ROLE atlas_migrator PASSWORD :'atlas_migrator_password';
\endif

-- ---------------------------------------------------------------------------
-- atlas_app_rw (LOGIN, runtime read-write). Sin ownership, sin DDL.
-- ---------------------------------------------------------------------------
SELECT NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'atlas_app_rw') AS create_atlas_app_rw \gset
\if :create_atlas_app_rw
  CREATE ROLE atlas_app_rw LOGIN;
\endif
ALTER ROLE atlas_app_rw WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS CONNECTION LIMIT 50;
\if :{?atlas_app_rw_password}
  ALTER ROLE atlas_app_rw PASSWORD :'atlas_app_rw_password';
\endif

-- ---------------------------------------------------------------------------
-- atlas_app_ro (LOGIN, runtime read-only / reporting). Transacciones read-only
-- por defecto y timeouts defensivos para consultas de dashboard/BI.
-- ---------------------------------------------------------------------------
SELECT NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'atlas_app_ro') AS create_atlas_app_ro \gset
\if :create_atlas_app_ro
  CREATE ROLE atlas_app_ro LOGIN;
\endif
ALTER ROLE atlas_app_ro WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS CONNECTION LIMIT 25;
ALTER ROLE atlas_app_ro SET default_transaction_read_only = on;
ALTER ROLE atlas_app_ro SET statement_timeout = '5s';
ALTER ROLE atlas_app_ro SET idle_in_transaction_session_timeout = '15s';
ALTER ROLE atlas_app_ro SET lock_timeout = '1s';
\if :{?atlas_app_ro_password}
  ALTER ROLE atlas_app_ro PASSWORD :'atlas_app_ro_password';
\endif

\echo 'Roles Atlas creados/actualizados: atlas_owner, atlas_migrator, atlas_app_rw, atlas_app_ro.'
\echo 'Siguiente paso: aplicar ops/postgres/grants.sql como owner (o migrator con SET ROLE atlas_owner).'
