-- Reporte read-only de privilegios para schemas de dominio y read_api.
\set ON_ERROR_STOP on
\if :{?read_schema}
\else
  \set read_schema 'read_api'
\endif

\echo '== Roles Atlas =='
SELECT rolname, rolcanlogin AS can_login, rolsuper AS is_super, rolcreatedb AS can_create_db,
       rolcreaterole AS can_create_role, rolconnlimit AS conn_limit
FROM pg_roles
WHERE rolname IN ('atlas_owner', 'atlas_migrator', 'atlas_app_rw', 'atlas_app_ro')
ORDER BY rolname;

\echo '== Privilegios por schema de escritura =='
WITH schemas(schema_name) AS (
  VALUES ('iam'), ('customer'), ('privacy'), ('telemetry'), ('catalog'), ('risk'),
         ('case_management'), ('audit'), ('integrations'), ('messaging'), ('platform_ops')
)
SELECT schema_name,
       has_schema_privilege('atlas_app_rw', schema_name, 'USAGE') AS rw_usage,
       has_schema_privilege('atlas_app_rw', schema_name, 'CREATE') AS rw_create_should_be_false,
       has_schema_privilege('atlas_app_ro', schema_name, 'USAGE') AS ro_usage_should_be_false
FROM schemas
ORDER BY schema_name;

\echo '== Cobertura CRUD de atlas_app_rw y aislamiento de atlas_app_ro =='
SELECT schemaname,
       count(*) AS tables,
       count(*) FILTER (WHERE has_table_privilege('atlas_app_rw', format('%I.%I', schemaname, tablename), 'SELECT,INSERT,UPDATE,DELETE')) AS rw_crud,
       count(*) FILTER (WHERE has_table_privilege('atlas_app_rw', format('%I.%I', schemaname, tablename), 'TRUNCATE')) AS rw_truncate_should_be_0,
       count(*) FILTER (WHERE has_table_privilege('atlas_app_ro', format('%I.%I', schemaname, tablename), 'SELECT')) AS ro_select_should_be_0
FROM pg_tables
WHERE schemaname IN ('iam','customer','privacy','telemetry','catalog','risk','case_management','audit','integrations','messaging','platform_ops')
GROUP BY schemaname
ORDER BY schemaname;

\echo '== atlas_app_ro en read_api =='
SELECT count(*) AS views,
       count(*) FILTER (WHERE has_table_privilege('atlas_app_ro', format('%I.%I', schemaname, viewname), 'SELECT')) AS can_select,
       count(*) FILTER (WHERE has_table_privilege('atlas_app_ro', format('%I.%I', schemaname, viewname), 'INSERT')) AS can_insert_should_be_0
FROM pg_views
WHERE schemaname = :'read_schema';
