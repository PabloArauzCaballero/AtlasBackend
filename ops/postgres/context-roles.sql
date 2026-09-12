-- Atlas · roles runtime por contexto (AT-019).
-- Ejecutar como superusuario o como atlas_owner después de las migraciones y de grants.sql.
-- Cada rol de contexto tiene DML SOLO sobre las tablas de su schema; ni DDL, ni acceso a otros
-- schemas. `atlas_app_rw` (todo el monolito) sigue existiendo: estos roles son los que usará un
-- ejecutable extraído (el piloto de Mensajería primero) y los que prueban que un contexto no lee lo ajeno.
--
--   psql -v DBNAME=atlas -v ctx_password='...' -f ops/postgres/context-roles.sql
--
\set ON_ERROR_STOP on
-- Sin contraseña explícita el guion NO continúa: un valor por defecto dejaría a tres roles con LOGIN y
-- DML sobre PII y cartera con una contraseña conocida. Revisión independiente A, hallazgo bloqueante 1.
\if :{?ctx_password}
\else
  \echo 'ERROR: falta -v ctx_password. Ejecuta: psql -v DBNAME=... -v ctx_password=... -f ops/postgres/context-roles.sql'
  \quit 1
\endif
-- Las variables de psql no se interpolan dentro de un bloque DO: se pasa la contraseña por configuración de sesión.
SELECT set_config('atlas.ctx_password', :'ctx_password', false);

DO $$
DECLARE
  ctx record;
BEGIN
  FOR ctx IN
    SELECT * FROM (VALUES
      ('atlas_ctx_messaging', 'messaging'),
      ('atlas_ctx_credit', 'credit'),
      ('atlas_ctx_customer', 'customer')
    ) AS t(role_name, schema_name)
  LOOP
    -- La contraseña se fija SOLO al crear el rol: reejecutar el guion (que es idempotente para grants)
    -- no debe rotar la credencial de un rol en uso; eso tumbaría al piloto en caliente. Para rotar a
    -- propósito: ALTER ROLE atlas_ctx_<ctx> PASSWORD '...' a mano, con el proceso detenido o reiniciándolo.
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = ctx.role_name) THEN
      EXECUTE format('CREATE ROLE %I LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT PASSWORD %L', ctx.role_name, current_setting('atlas.ctx_password'));
    END IF;
    -- Sin search_path transversal: el rol sólo ve su schema (y platform_ops para outbox/inbox/idempotencia).
    EXECUTE format('ALTER ROLE %I SET search_path = %I, platform_ops', ctx.role_name, ctx.schema_name);
    EXECUTE format('GRANT CONNECT ON DATABASE %I TO %I', current_database(), ctx.role_name);
    EXECUTE format('GRANT USAGE ON SCHEMA %I TO %I', ctx.schema_name, ctx.role_name);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA %I TO %I', ctx.schema_name, ctx.role_name);
    EXECUTE format('GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA %I TO %I', ctx.schema_name, ctx.role_name);
    -- Lo que el migrador cree después en ESTE schema también es del contexto; en otros schemas, no.
    -- `atlas_owner` puede no existir todavía (en CI este guion corre ANTES del bootstrap de roles): sin él
    -- no hay privilegios por defecto que declarar, y exigirlo abortaría el guion entero. Se avisa y sigue.
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'atlas_owner') THEN
      EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE atlas_owner IN SCHEMA %I GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO %I', ctx.schema_name, ctx.role_name);
      EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE atlas_owner IN SCHEMA %I GRANT USAGE, SELECT ON SEQUENCES TO %I', ctx.schema_name, ctx.role_name);
    ELSE
      RAISE WARNING 'atlas_owner no existe todavía: sin privilegios por defecto para % en %. Reejecuta este guion después de yarn db:roles:bootstrap.', ctx.role_name, ctx.schema_name;
    END IF;
    -- Outbox/inbox/idempotencia son infraestructura compartida mientras se comparte base (AT-022).
    EXECUTE format('GRANT USAGE ON SCHEMA platform_ops TO %I', ctx.role_name);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON platform_ops.outbox_events, platform_ops.inbox_receipts, platform_ops.idempotency_keys TO %I', ctx.role_name);
    EXECUTE format('GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA platform_ops TO %I', ctx.role_name);
  END LOOP;
END $$;
