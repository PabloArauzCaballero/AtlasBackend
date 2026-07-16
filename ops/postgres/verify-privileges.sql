-- ============================================================================
-- Atlas · Verificación de privilegios (Fase 2 del plan de mejora del modelo de datos)
-- ============================================================================
--
-- Reporte READ-ONLY del estado de privilegios de los roles Atlas. No modifica nada; puede correr
-- como cualquier rol con acceso al catálogo. Úsalo tras bootstrap-roles.sql + grants.sql, o en CI.
--
-- Uso:
--   psql "$DATABASE_URL" -v core_schema=public -v read_schema=read_api -f ops/postgres/verify-privileges.sql
-- ============================================================================

\set ON_ERROR_STOP on
\if :{?core_schema}
\else
  \set core_schema 'public'
\endif
\if :{?read_schema}
\else
  \set read_schema 'read_api'
\endif

\echo '== Roles Atlas y atributos =='
SELECT rolname, rolcanlogin AS can_login, rolsuper AS is_super, rolcreatedb AS can_create_db,
       rolcreaterole AS can_create_role, rolconnlimit AS conn_limit
FROM pg_roles
WHERE rolname IN ('atlas_owner', 'atlas_migrator', 'atlas_app_rw', 'atlas_app_ro')
ORDER BY rolname;

\echo '== atlas_app_ro: settings de sesión (deben forzar read-only + timeouts) =='
SELECT rolname, unnest(rolconfig) AS setting
FROM pg_roles
WHERE rolname = 'atlas_app_ro';

\echo '== USAGE/CREATE en schemas =='
SELECT 'atlas_app_rw USAGE on core' AS check, has_schema_privilege('atlas_app_rw', :'core_schema', 'USAGE') AS ok
UNION ALL SELECT 'atlas_app_rw CREATE on core (debe ser false)', has_schema_privilege('atlas_app_rw', :'core_schema', 'CREATE')
UNION ALL SELECT 'atlas_app_ro USAGE on read_api', has_schema_privilege('atlas_app_ro', :'read_schema', 'USAGE')
UNION ALL SELECT 'atlas_app_ro USAGE on core (debe ser false)', has_schema_privilege('atlas_app_ro', :'core_schema', 'USAGE');

\echo '== atlas_app_rw: cobertura CRUD en tablas del schema core =='
SELECT
  count(*) AS core_tables,
  count(*) FILTER (WHERE has_table_privilege('atlas_app_rw', format('%I.%I', schemaname, tablename), 'SELECT')) AS can_select,
  count(*) FILTER (WHERE has_table_privilege('atlas_app_rw', format('%I.%I', schemaname, tablename), 'INSERT')) AS can_insert,
  count(*) FILTER (WHERE has_table_privilege('atlas_app_rw', format('%I.%I', schemaname, tablename), 'UPDATE')) AS can_update,
  count(*) FILTER (WHERE has_table_privilege('atlas_app_rw', format('%I.%I', schemaname, tablename), 'DELETE')) AS can_delete,
  count(*) FILTER (WHERE has_table_privilege('atlas_app_rw', format('%I.%I', schemaname, tablename), 'TRUNCATE')) AS can_truncate_should_be_0
FROM pg_tables
WHERE schemaname = :'core_schema';

\echo '== atlas_app_ro: acceso a tablas base del core (todo debe ser 0) =='
SELECT
  count(*) FILTER (WHERE has_table_privilege('atlas_app_ro', format('%I.%I', schemaname, tablename), 'SELECT')) AS can_select_should_be_0,
  count(*) FILTER (WHERE has_table_privilege('atlas_app_ro', format('%I.%I', schemaname, tablename), 'INSERT')) AS can_insert_should_be_0
FROM pg_tables
WHERE schemaname = :'core_schema';

\echo '== atlas_app_ro: acceso a vistas de read_api (SELECT sí; escritura 0) =='
SELECT
  count(*) AS read_api_views,
  count(*) FILTER (WHERE has_table_privilege('atlas_app_ro', format('%I.%I', schemaname, viewname), 'SELECT')) AS can_select,
  count(*) FILTER (WHERE has_table_privilege('atlas_app_ro', format('%I.%I', schemaname, viewname), 'INSERT')) AS can_insert_should_be_0
FROM pg_views
WHERE schemaname = :'read_schema';
