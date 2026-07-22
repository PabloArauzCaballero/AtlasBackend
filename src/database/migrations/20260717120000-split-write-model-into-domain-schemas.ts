import { QueryInterface } from 'sequelize';
import { ATLAS_DOMAIN_TABLES, ATLAS_SCHEMAS, AtlasSchema } from '../domain-schemas.js';

const quote = (identifier: string): string => `"${identifier.replace(/"/g, '""')}"`;

const TABLE_SCHEMA_VALUES = Object.entries(ATLAS_DOMAIN_TABLES)
  .flatMap(([schema, tables]) => tables.map((table) => `('${table}', '${schema}')`))
  .join(',\n      ');

async function moveTable(queryInterface: QueryInterface, table: string, source: string, target: AtlasSchema): Promise<void> {
  await queryInterface.sequelize.query(`
    DO $$
    BEGIN
      IF to_regclass('${source}.${table}') IS NOT NULL AND to_regclass('${target}.${table}') IS NULL THEN
        ALTER TABLE ${quote(source)}.${quote(table)} SET SCHEMA ${quote(target)};
      END IF;
    END$$;
  `);
}

async function moveOwnedSequences(queryInterface: QueryInterface, source: string, target: AtlasSchema): Promise<void> {
  await queryInterface.sequelize.query(`
    DO $$
    DECLARE sequence_name text;
    BEGIN
      FOR sequence_name IN
        SELECT sequence.relname
          FROM pg_class sequence
          JOIN pg_namespace sequence_schema ON sequence_schema.oid = sequence.relnamespace
          JOIN pg_depend dependency ON dependency.objid = sequence.oid AND dependency.deptype IN ('a', 'i')
          JOIN pg_class owned_table ON owned_table.oid = dependency.refobjid
          JOIN pg_namespace table_schema ON table_schema.oid = owned_table.relnamespace
         WHERE sequence.relkind = 'S'
           AND sequence_schema.nspname = '${source}'
           AND table_schema.nspname = '${target}'
      LOOP
        EXECUTE format('ALTER SEQUENCE %I.%I SET SCHEMA %I', '${source}', sequence_name, '${target}');
      END LOOP;
    END$$;
  `);
}

async function applyRuntimeGrants(queryInterface: QueryInterface, schema: AtlasSchema): Promise<void> {
  await queryInterface.sequelize.query(`
    REVOKE CREATE ON SCHEMA ${quote(schema)} FROM PUBLIC;
    DO $$
    BEGIN
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'atlas_app_rw') THEN
        GRANT USAGE ON SCHEMA ${quote(schema)} TO atlas_app_rw;
        GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA ${quote(schema)} TO atlas_app_rw;
        GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA ${quote(schema)} TO atlas_app_rw;
      END IF;
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'atlas_app_ro') THEN
        REVOKE ALL ON ALL TABLES IN SCHEMA ${quote(schema)} FROM atlas_app_ro;
        REVOKE ALL ON ALL SEQUENCES IN SCHEMA ${quote(schema)} FROM atlas_app_ro;
      END IF;
    END$$;
  `);
}

async function syncCatalogMetadata(queryInterface: QueryInterface, direction: 'domain' | 'public'): Promise<void> {
  const source = direction === 'domain' ? `'public'` : 'mapping.domain_schema';
  const target = direction === 'domain' ? 'mapping.domain_schema' : `'public'`;
  const mapping = `(VALUES ${TABLE_SCHEMA_VALUES}) AS mapping(table_name, domain_schema)`;

  await queryInterface.sequelize.query(`
    UPDATE platform_ops.system_data_entity_catalog entity
       SET schema_name = ${target}, _updated_at = NOW()
      FROM ${mapping}
     WHERE entity.table_name = mapping.table_name AND entity.schema_name = ${source};

    UPDATE platform_ops.system_data_field_catalog field
       SET schema_name = ${target}, _updated_at = NOW()
      FROM ${mapping}
     WHERE field.table_name = mapping.table_name AND field.schema_name = ${source};

    UPDATE platform_ops.system_data_field_catalog field
       SET referenced_schema = ${target}, _updated_at = NOW()
      FROM ${mapping}
     WHERE field.referenced_table = mapping.table_name AND field.referenced_schema = ${source};

    UPDATE platform_ops.system_data_relationship_catalog relationship
       SET source_schema = ${target}, _updated_at = NOW()
      FROM ${mapping}
     WHERE relationship.source_table = mapping.table_name AND relationship.source_schema = ${source};

    UPDATE platform_ops.system_data_relationship_catalog relationship
       SET target_schema = ${target}, _updated_at = NOW()
      FROM ${mapping}
     WHERE relationship.target_table = mapping.table_name AND relationship.target_schema = ${source};

    UPDATE platform_ops.system_operational_rule_catalog rule
       SET schema_name = ${target}, _updated_at = NOW()
      FROM ${mapping}
     WHERE rule.table_name = mapping.table_name AND rule.schema_name = ${source};
  `);
}

export async function up({ context: queryInterface }: { context: QueryInterface }): Promise<void> {
  for (const schema of Object.values(ATLAS_SCHEMAS)) {
    await queryInterface.sequelize.query(`CREATE SCHEMA IF NOT EXISTS ${quote(schema)};`);
  }

  for (const [schema, tables] of Object.entries(ATLAS_DOMAIN_TABLES) as [AtlasSchema, readonly string[]][]) {
    for (const table of tables) await moveTable(queryInterface, table, 'public', schema);
    await moveOwnedSequences(queryInterface, 'public', schema);
    await applyRuntimeGrants(queryInterface, schema);
  }

  await queryInterface.sequelize.query(`
    DO $$
    BEGIN
      IF to_regclass('public.audit_event_feed') IS NOT NULL AND to_regclass('audit.audit_event_feed') IS NULL THEN
        ALTER VIEW public.audit_event_feed SET SCHEMA audit;
      END IF;
    END$$;
  `);
  await syncCatalogMetadata(queryInterface, 'domain');
}

export async function down({ context: queryInterface }: { context: QueryInterface }): Promise<void> {
  await queryInterface.sequelize.query(`
    DO $$
    BEGIN
      IF to_regclass('audit.audit_event_feed') IS NOT NULL AND to_regclass('public.audit_event_feed') IS NULL THEN
        ALTER VIEW audit.audit_event_feed SET SCHEMA public;
      END IF;
    END$$;
  `);
  await syncCatalogMetadata(queryInterface, 'public');

  for (const [schema, tables] of [...(Object.entries(ATLAS_DOMAIN_TABLES) as [AtlasSchema, readonly string[]][])].reverse()) {
    for (const table of [...tables].reverse()) await moveTable(queryInterface, table, schema, 'public' as AtlasSchema);
    await moveOwnedSequences(queryInterface, schema, 'public' as AtlasSchema);
  }

  for (const schema of [...Object.values(ATLAS_SCHEMAS)].reverse()) {
    await queryInterface.sequelize.query(`DROP SCHEMA IF EXISTS ${quote(schema)} RESTRICT;`);
  }
}
