/**
 * @file Migración reversible: evoluciona el esquema PostgreSQL en orden.
 * @business Devuelve al portal el inventario de tablas, columnas y relaciones de la versión de esquema vigente, que en los entornos desplegados de cero se quedaba en «0 tablas».
 * @system repone `schema_tables`, `schema_columns` y `schema_relationships` leyendo `information_schema` y `pg_index`.
 */
import { QueryInterface, Transaction } from 'sequelize';
import { ATLAS_SCHEMAS, atlasSchemaFor } from '../domain-schemas.js';

type MigrationContext = { context: QueryInterface };

const VERSIONS = `${atlasSchemaFor('schema_versions')}.schema_versions`;
const TABLES = `${atlasSchemaFor('schema_tables')}.schema_tables`;
const COLUMNS = `${atlasSchemaFor('schema_columns')}.schema_columns`;
const RELATIONSHIPS = `${atlasSchemaFor('schema_relationships')}.schema_relationships`;

/**
 * Marca de las filas DERIVADAS. El inventario se calcula del esquema real, así que esta migración sólo
 * borra y vuelve a escribir lo que lleva esta marca (o la del seeder de 2026-08-20, que hacía lo mismo
 * y que `seed:pull` ya no trae): lo que alguien proponga por el portal lleva otra fecha y no se toca.
 */
const DERIVED_AT = new Date('2026-10-01T22:00:00.000Z');
const LEGACY_DERIVED_AT = new Date('2026-08-20T20:00:00.000Z');

/**
 * El catálogo se quedó sin repoblar cuando el seeder que lo llenaba salió del repositorio (25fb6cdc):
 * en TEST y en cualquier entorno nuevo la versión `v1.0` existe con su nota «121 tables» y ninguna tabla,
 * y el portal enseñaba «0 tablas / 0 columnas / 0 relaciones». Como migración corre en cada despliegue,
 * que es lo que el seeder nunca consiguió.
 *
 * Los esquemas salen de `ATLAS_SCHEMAS`, no de una lista copiada: cuando nazca un esquema de dominio
 * (`support`, `partner`, `expedientes` ya lo hicieron después del seeder) entra solo en el siguiente
 * recálculo. `public` y `read_api` entran porque guardan infraestructura y las vistas de lectura.
 */
const CATALOGUED_SCHEMAS = [...Object.values(ATLAS_SCHEMAS), 'read_api', 'public'];

/** Columnas que nunca se editan (regla 2 del módulo `schema-management`). */
const IMMUTABLE_COLUMNS = ['_id', '_tenant_id', '_created_at', 'created_at'];

/** Heurística de PII por nombre de columna: marca de más antes que de menos. */
const PII_MARKERS = [
  'email',
  'phone',
  'msisdn',
  'document_number',
  'national_id',
  'full_name',
  'first_name',
  'last_name',
  'birth',
  'address',
  'latitude',
  'longitude',
  'ip_address',
  'device_id',
  'selfie',
  'biometric',
  'account_number',
  'card_',
  'salary',
  'income',
];

const likeAny = (column: string): string => PII_MARKERS.map((marker) => `${column} LIKE '%${marker}%'`).join(' OR ');
const quoted = (values: readonly string[]): string => values.map((value) => `'${value}'`).join(', ');

async function run(
  queryInterface: QueryInterface,
  transaction: Transaction,
  sql: string,
  replacements: Record<string, unknown> = {},
): Promise<void> {
  await queryInterface.sequelize.query(sql, { transaction, replacements });
}

/** Borra sólo lo derivado, en el orden que piden las claves foráneas. */
async function deleteDerived(queryInterface: QueryInterface, transaction: Transaction, versionId: string): Promise<void> {
  const derived = `SELECT _id FROM ${TABLES} WHERE schema_version_id = :versionId AND created_at IN (:marks)`;
  const replacements = { versionId, marks: [DERIVED_AT.toISOString(), LEGACY_DERIVED_AT.toISOString()] };
  await run(
    queryInterface,
    transaction,
    `DELETE FROM ${RELATIONSHIPS} WHERE source_table_id IN (${derived}) OR target_table_id IN (${derived})`,
    replacements,
  );
  await run(queryInterface, transaction, `DELETE FROM ${COLUMNS} WHERE schema_table_id IN (${derived})`, replacements);
  await run(queryInterface, transaction, `DELETE FROM ${TABLES} WHERE _id IN (${derived})`, replacements);
}

export async function up({ context: queryInterface }: MigrationContext): Promise<void> {
  const transaction = await queryInterface.sequelize.transaction();
  try {
    const [versionRows] = (await queryInterface.sequelize.query(
      `SELECT _id FROM ${VERSIONS} WHERE is_active = true ORDER BY _id ASC LIMIT 1`,
      { transaction },
    )) as [{ _id: string }[], unknown];
    // Sin versión activa no hay dónde colgar el inventario, y fabricar una atribuiría un origen falso.
    if (!versionRows.length) {
      await transaction.commit();
      return;
    }
    const versionId = versionRows[0]._id;
    const replacements = { versionId, createdAt: DERIVED_AT.toISOString() };

    await deleteDerived(queryInterface, transaction, versionId);

    // `table_type` y `is_append_only` salen de la ESTRUCTURA: sin `_updated_at` no hay dónde registrar una modificación.
    await run(
      queryInterface,
      transaction,
      `
      INSERT INTO ${TABLES} (
        schema_version_id, table_name, table_type, is_append_only, is_tenant_scoped,
        description, created_by_platform_user_id, created_at, is_deleted, _created_at, _updated_at
      )
      SELECT
        CAST(:versionId AS BIGINT),
        t.table_schema || '.' || t.table_name,
        CASE
          WHEN t.table_schema = 'audit' THEN 'audit'
          WHEN t.table_schema IN ('catalog', 'read_api') THEN 'catalog'
          WHEN t.table_schema IN ('platform_ops', 'telemetry', 'integrations') THEN 'operational'
          ELSE 'transactional'
        END,
        NOT EXISTS (
          SELECT 1 FROM information_schema.columns c
          WHERE c.table_schema = t.table_schema AND c.table_name = t.table_name AND c.column_name = '_updated_at'
        ),
        EXISTS (
          SELECT 1 FROM information_schema.columns c
          WHERE c.table_schema = t.table_schema AND c.table_name = t.table_name AND c.column_name = '_tenant_id'
        ),
        obj_description(format('%I.%I', t.table_schema, t.table_name)::regclass, 'pg_class'),
        CAST(NULL AS BIGINT), CAST(:createdAt AS TIMESTAMPTZ), false, CAST(:createdAt AS TIMESTAMPTZ), CAST(:createdAt AS TIMESTAMPTZ)
      FROM information_schema.tables t
      WHERE t.table_type = 'BASE TABLE'
        AND t.table_schema IN (${quoted(CATALOGUED_SCHEMAS)})
        AND t.table_name NOT IN ('schema_versions', 'schema_tables', 'schema_columns', 'schema_relationships', 'SequelizeMeta', 'SequelizeData')
        AND t.table_name NOT LIKE '%migrations%'
        AND t.table_name NOT LIKE '%seeder%'
        -- Lo que alguien ya propuso por el portal con ese nombre manda: no se duplica ni se pisa.
        AND NOT EXISTS (
          SELECT 1 FROM ${TABLES} existing
          WHERE existing.schema_version_id = :versionId AND existing.is_deleted = false
            AND existing.table_name = t.table_schema || '.' || t.table_name
        )
      ORDER BY t.table_schema, t.table_name
    `,
      replacements,
    );

    await run(
      queryInterface,
      transaction,
      `
      INSERT INTO ${COLUMNS} (
        schema_table_id, column_name, column_type, is_nullable, is_immutable, is_pii, is_indexed,
        default_value, description, created_by_platform_user_id, created_at, is_deleted, _created_at, _updated_at
      )
      SELECT
        st._id,
        c.column_name,
        CASE
          WHEN c.character_maximum_length IS NOT NULL THEN c.data_type || '(' || c.character_maximum_length || ')'
          WHEN c.numeric_precision IS NOT NULL AND c.data_type = 'numeric'
            THEN c.data_type || '(' || c.numeric_precision || ',' || COALESCE(c.numeric_scale, 0) || ')'
          ELSE c.data_type
        END,
        c.is_nullable = 'YES',
        c.column_name IN (${quoted(IMMUTABLE_COLUMNS)}),
        (${likeAny('c.column_name')}),
        EXISTS (
          SELECT 1
          FROM pg_index i
          JOIN pg_class rel ON rel.oid = i.indrelid
          JOIN pg_namespace ns ON ns.oid = rel.relnamespace
          JOIN pg_attribute a ON a.attrelid = rel.oid AND a.attnum = ANY (i.indkey)
          WHERE ns.nspname = split_part(st.table_name, '.', 1)
            AND rel.relname = split_part(st.table_name, '.', 2)
            AND a.attname = c.column_name
        ),
        c.column_default,
        col_description(
          format('%I.%I', split_part(st.table_name, '.', 1), split_part(st.table_name, '.', 2))::regclass,
          c.ordinal_position
        ),
        CAST(NULL AS BIGINT), CAST(:createdAt AS TIMESTAMPTZ), false, CAST(:createdAt AS TIMESTAMPTZ), CAST(:createdAt AS TIMESTAMPTZ)
      FROM ${TABLES} st
      JOIN information_schema.columns c
        ON c.table_schema = split_part(st.table_name, '.', 1)
       AND c.table_name = split_part(st.table_name, '.', 2)
      WHERE st.schema_version_id = :versionId AND st.created_at = CAST(:createdAt AS TIMESTAMPTZ)
      ORDER BY st._id, c.ordinal_position
    `,
      replacements,
    );

    // Las FK se copian siempre inmutables: es la regla 1 del módulo («cambios de FK = nueva versión»).
    await run(
      queryInterface,
      transaction,
      `
      INSERT INTO ${RELATIONSHIPS} (
        schema_version_id, source_table_id, source_column_name, target_table_id, target_column_name,
        cascade_delete, is_immutable, created_by_platform_user_id, created_at, _created_at
      )
      SELECT DISTINCT
        CAST(:versionId AS BIGINT), source._id, kcu.column_name, target._id, target_col.column_name,
        rc.delete_rule = 'CASCADE', true, CAST(NULL AS BIGINT), CAST(:createdAt AS TIMESTAMPTZ), CAST(:createdAt AS TIMESTAMPTZ)
      FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu
        ON kcu.constraint_name = tc.constraint_name AND kcu.constraint_schema = tc.constraint_schema
      JOIN information_schema.referential_constraints rc
        ON rc.constraint_name = tc.constraint_name AND rc.constraint_schema = tc.constraint_schema
      JOIN information_schema.key_column_usage target_col
        ON target_col.constraint_name = rc.unique_constraint_name
       AND target_col.constraint_schema = rc.unique_constraint_schema
       AND target_col.ordinal_position = kcu.position_in_unique_constraint
      JOIN ${TABLES} source
        ON source.schema_version_id = :versionId AND source.is_deleted = false
       AND source.table_name = tc.table_schema || '.' || tc.table_name
      JOIN ${TABLES} target
        ON target.schema_version_id = :versionId AND target.is_deleted = false
       AND target.table_name = target_col.table_schema || '.' || target_col.table_name
      WHERE tc.constraint_type = 'FOREIGN KEY'
        AND tc.table_schema IN (${quoted(CATALOGUED_SCHEMAS)})
      ON CONFLICT DO NOTHING
    `,
      replacements,
    );

    await transaction.commit();
  } catch (error) {
    await transaction.rollback();
    throw error;
  }
}

export async function down({ context: queryInterface }: MigrationContext): Promise<void> {
  const transaction = await queryInterface.sequelize.transaction();
  try {
    const [versionRows] = (await queryInterface.sequelize.query(
      `SELECT _id FROM ${VERSIONS} WHERE is_active = true ORDER BY _id ASC LIMIT 1`,
      { transaction },
    )) as [{ _id: string }[], unknown];
    if (versionRows.length) await deleteDerived(queryInterface, transaction, versionRows[0]._id);
    await transaction.commit();
  } catch (error) {
    await transaction.rollback();
    throw error;
  }
}
