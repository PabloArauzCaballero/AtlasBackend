-- Atlas · roles runtime por contexto (AT-019).
-- Ejecutar como superusuario o como atlas_owner después de las migraciones y de grants.sql.
-- Cada rol de contexto tiene DML SOLO sobre las tablas de su schema; ni DDL, ni acceso a otros
-- schemas. `atlas_app_rw` (todo el monolito) sigue existiendo: estos roles son los que usará un
-- ejecutable extraído (el piloto de Mensajería primero) y los que prueban que un contexto no lee lo ajeno.
--
--   psql -v DBNAME=atlas -v ctx_password='...' -f ops/postgres/context-roles.sql
--
\set ON_ERROR_STOP on
\if :{?ctx_password}
\else
  \set ctx_password 'change-me'
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
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = ctx.role_name) THEN
      EXECUTE format('CREATE ROLE %I LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT', ctx.role_name);
    END IF;
    EXECUTE format('ALTER ROLE %I PASSWORD %L', ctx.role_name, current_setting('atlas.ctx_password'));
    -- Sin search_path transversal: el rol sólo ve su schema (y platform_ops para outbox/inbox/idempotencia).
    EXECUTE format('ALTER ROLE %I SET search_path = %I, platform_ops', ctx.role_name, ctx.schema_name);
    EXECUTE format('GRANT CONNECT ON DATABASE %I TO %I', current_database(), ctx.role_name);
    EXECUTE format('GRANT USAGE ON SCHEMA %I TO %I', ctx.schema_name, ctx.role_name);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA %I TO %I', ctx.schema_name, ctx.role_name);
    EXECUTE format('GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA %I TO %I', ctx.schema_name, ctx.role_name);
    -- Lo que el migrador cree después en ESTE schema también es del contexto; en otros schemas, no.
    EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE atlas_owner IN SCHEMA %I GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO %I', ctx.schema_name, ctx.role_name);
    EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE atlas_owner IN SCHEMA %I GRANT USAGE, SELECT ON SEQUENCES TO %I', ctx.schema_name, ctx.role_name);
    -- Outbox/inbox/idempotencia son infraestructura compartida mientras se comparte base (AT-022).
    EXECUTE format('GRANT USAGE ON SCHEMA platform_ops TO %I', ctx.role_name);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON platform_ops.outbox_events, platform_ops.inbox_receipts, platform_ops.idempotency_keys TO %I', ctx.role_name);
    EXECUTE format('GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA platform_ops TO %I', ctx.role_name);
  END LOOP;
END $$;
