-- Atlas · privilegios mínimos para schemas de dominio + read_api.
-- Ejecutar como atlas_owner (o atlas_migrator con SET ROLE atlas_owner) después de las migraciones.
\set ON_ERROR_STOP on

\if :{?read_schema}
\else
  \set read_schema 'read_api'
\endif

CREATE SCHEMA IF NOT EXISTS :"read_schema" AUTHORIZATION atlas_owner;
GRANT CONNECT ON DATABASE :"DBNAME" TO atlas_app_rw, atlas_app_ro, atlas_migrator;

DO $$
DECLARE
  schema_name text;
  -- La lista tiene que ser la MISMA que `ATLAS_SCHEMAS` (src/database/domain-schemas.ts): el gate
  -- `check:db-privileges --strict` la deriva de ahí, así que un schema de dominio ausente aquí no
  -- es un detalle de provisión — es el rol de la aplicación sin acceso a un dominio entero.
  -- `credit` faltaba: `atlas_app_rw` no podía leer ni escribir solicitudes, líneas ni préstamos.
  write_schemas constant text[] := ARRAY[
    'iam', 'credit', 'customer', 'privacy', 'telemetry', 'catalog', 'risk', 'case_management',
    'audit', 'integrations', 'messaging', 'platform_ops',
    -- Expediente verificable del comercio (ADR-0009). Sin este privilegio la API arranca, la
    -- migración pasa y la primera petición responde 500 «permission denied for schema partner».
    'partner',
    -- Motor de soporte: expediente, canal, transcripción y conocimiento. Sin este privilegio, la
    -- primera persona que pida ayuda recibe un 500 en el canal que existe justamente para eso.
    'support',
    -- El explorador de archivos del cliente: carpetas, permisos y bitácora. Sin el privilegio, el
    -- alta se completa —los archivos siguen yendo al almacén— y quien revisa el caso abre una
    -- carpeta que responde 500 «permission denied for schema expedientes».
    'expedientes'
  ];
BEGIN
  FOREACH schema_name IN ARRAY write_schemas LOOP
    IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = schema_name) THEN
      EXECUTE format('GRANT USAGE ON SCHEMA %I TO atlas_app_rw', schema_name);
      EXECUTE format('REVOKE CREATE ON SCHEMA %I FROM atlas_app_rw', schema_name);
      EXECUTE format('REVOKE CREATE ON SCHEMA %I FROM PUBLIC', schema_name);
      EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA %I TO atlas_app_rw', schema_name);
      EXECUTE format('GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA %I TO atlas_app_rw', schema_name);
      EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE atlas_owner IN SCHEMA %I GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO atlas_app_rw', schema_name);
      EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE atlas_owner IN SCHEMA %I GRANT USAGE, SELECT ON SEQUENCES TO atlas_app_rw', schema_name);

      EXECUTE format('REVOKE ALL ON ALL TABLES IN SCHEMA %I FROM atlas_app_ro', schema_name);
      EXECUTE format('REVOKE ALL ON ALL SEQUENCES IN SCHEMA %I FROM atlas_app_ro', schema_name);
    END IF;
  END LOOP;
END$$;

GRANT USAGE ON SCHEMA :"read_schema" TO atlas_app_ro, atlas_app_rw;
GRANT SELECT ON ALL TABLES IN SCHEMA :"read_schema" TO atlas_app_ro, atlas_app_rw;
ALTER DEFAULT PRIVILEGES FOR ROLE atlas_owner IN SCHEMA :"read_schema"
  GRANT SELECT ON TABLES TO atlas_app_ro, atlas_app_rw;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON ALL TABLES IN SCHEMA :"read_schema" FROM atlas_app_ro;

\echo 'Grants aplicados: atlas_app_rw en 12 schemas de dominio; atlas_app_ro solo en read_api.'
