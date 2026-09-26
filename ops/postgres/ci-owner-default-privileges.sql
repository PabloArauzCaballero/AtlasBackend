-- Atlas · CI: privilegios por defecto del DUEÑO REAL de los objetos hacia el runtime.
--
-- En producción los objetos pertenecen a `atlas_owner` (el migrador hace `SET ROLE atlas_owner`) y
-- `grants.sql` declara `ALTER DEFAULT PRIVILEGES FOR ROLE atlas_owner`: una tabla creada después por una
-- migración nace ya accesible para `atlas_app_rw`.
--
-- En el job de CI las migraciones las aplica el superusuario del contenedor (`atlas`), así que los objetos
-- son de `atlas` y esos privilegios por defecto NO se aplican. Mientras no se recreaba nada no se notaba;
-- pero la suite AT-053 baja y vuelve a subir las migraciones de la transición, y las tablas recreadas
-- (`inbox_receipts`, `context_ownership`) quedaban sin permiso para el runtime. Este guion replica en CI,
-- para el dueño que CI usa de verdad, lo mismo que `grants.sql` hace para `atlas_owner`.
--
-- Sólo para CI. Ejecutar como `atlas` después de `grants.sql`.
\set ON_ERROR_STOP on

DO $$
DECLARE
  schema_name text;
  write_schemas constant text[] := ARRAY[
    'iam', 'credit', 'customer', 'privacy', 'telemetry', 'catalog', 'risk', 'case_management',
    'audit', 'integrations', 'messaging', 'platform_ops', 'partner', 'support', 'expedientes'
  ];
BEGIN
  FOREACH schema_name IN ARRAY write_schemas LOOP
    IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = schema_name) THEN
      EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE atlas IN SCHEMA %I GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO atlas_app_rw', schema_name);
      EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE atlas IN SCHEMA %I GRANT USAGE, SELECT ON SEQUENCES TO atlas_app_rw', schema_name);
    END IF;
  END LOOP;
END$$;
