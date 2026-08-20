/**
 * @file Migración reversible: evoluciona el esquema PostgreSQL en orden.
 * @business Esta pieza preserva la fuente de verdad y la evidencia histórica que soportan decisiones y cumplimiento.
 * @system define production para evolucionar, mapear, sembrar o consultar PostgreSQL de forma controlada.
 */
import { QueryInterface, QueryOptions, Transaction } from 'sequelize';

/**
 * Puebla el catálogo de schema (Fase 4A) leyendo la base REAL.
 *
 * `schema_versions` tenía su fila `v1.0` —con la nota «Initial schema: 121 tables»— y
 * `schema_tables`, `schema_columns` y `schema_relationships` estaban VACÍAS. El efecto en el portal
 * era exactamente el que se reportó: la lista de versiones mostraba «0 tablas / 0 columnas / 0
 * relaciones» y al abrir la versión aparecía «Esta versión no tiene tablas registradas», sobre una
 * base con 156 tablas en 13 esquemas. No era un fallo de la pantalla: no había nada que enseñar.
 *
 * El inventario se DERIVA de `information_schema` y `pg_index` en vez de escribirse a mano, por dos
 * razones: una lista de 156 tablas tecleada nace desactualizada, y el catálogo debe describir el
 * esquema que existe, no el que alguien recuerda. Volver a correr el seeder recalcula todo (borra e
 * inserta dentro de la misma transacción), así que sirve igual para poner al día una base viva.
 *
 * `table_name` guarda el nombre CUALIFICADO (`iam.internal_users`). El catálogo se creó cuando todo
 * vivía en `public`; hoy hay trece esquemas y sin el prefijo `users` de `iam` y `users` de `credit`
 * colisionarían en la misma fila. Además es lo que permite al portal agrupar el inventario por
 * esquema de datos, que es como se navega.
 */

const CREATED_AT = new Date('2026-08-20T20:00:00.000Z');

/** Los esquemas de negocio de Atlas. `public` entra también: guarda las tablas de infraestructura. */
const CATALOGUED_SCHEMAS = [
  'public',
  'audit',
  'case_management',
  'catalog',
  'credit',
  'customer',
  'iam',
  'integrations',
  'messaging',
  'platform_ops',
  'privacy',
  'read_api',
  'risk',
  'telemetry',
] as const;

/**
 * Columnas que NUNCA se editan, en ninguna tabla. Es la regla 2 del módulo `schema-management`
 * («columnas críticas inmutables»), aplicada aquí para que el catálogo la publique en vez de
 * dejarla escrita solo en el README.
 */
const IMMUTABLE_COLUMNS = ['_id', '_tenant_id', '_created_at', 'created_at'];

/**
 * Marcadores de PII por nombre de columna.
 *
 * Es una heurística y se comporta como tal: marca de más antes que de menos. Un falso positivo
 * cuesta una revisión; un falso negativo es un dato personal que el catálogo declara inocuo, y de
 * ahí cuelgan las políticas de retención y enmascarado.
 */
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

type Sql = { sql: string; replacements?: Record<string, unknown> };

async function run(queryInterface: QueryInterface, transaction: Transaction, { sql, replacements }: Sql): Promise<void> {
  const options: QueryOptions = { transaction, ...(replacements ? { replacements } : {}) };
  await queryInterface.sequelize.query(sql, options);
}

function likeAny(column: string, markers: readonly string[]): string {
  return markers.map((marker) => `${column} LIKE '%${marker}%'`).join(' OR ');
}

function schemaList(): string {
  return CATALOGUED_SCHEMAS.map((schema) => `'${schema}'`).join(', ');
}

export async function up({ context: queryInterface }: { context: QueryInterface }): Promise<void> {
  const transaction = await queryInterface.sequelize.transaction();
  try {
    const [versionRows] = (await queryInterface.sequelize.query(
      `SELECT _id FROM schema_versions WHERE is_active = true ORDER BY _id ASC LIMIT 1`,
      { transaction },
    )) as [{ _id: string }[], unknown];

    // Sin versión activa no hay dónde colgar el inventario. No se inventa una: la versión es un
    // artefacto de gobierno (quién la creó, sobre qué versión padre) y fabricarla desde un seeder
    // de inventario sería atribuirle un origen falso.
    if (!versionRows.length) {
      await transaction.commit();
      return;
    }
    const versionId = versionRows[0]._id;

    // Idempotencia por recálculo. Las tres tablas se vacían para ESTA versión y se vuelven a
    // derivar: así el seeder también sirve para reflejar migraciones posteriores.
    await run(queryInterface, transaction, {
      sql: `DELETE FROM schema_relationships WHERE schema_version_id = :versionId`,
      replacements: { versionId },
    });
    await run(queryInterface, transaction, {
      sql: `DELETE FROM schema_columns WHERE schema_table_id IN (SELECT _id FROM schema_tables WHERE schema_version_id = :versionId)`,
      replacements: { versionId },
    });
    await run(queryInterface, transaction, {
      sql: `DELETE FROM schema_tables WHERE schema_version_id = :versionId`,
      replacements: { versionId },
    });

    /*
     * `table_type` y `is_append_only` se derivan de la ESTRUCTURA, no del nombre.
     *
     * Una tabla es append-only cuando no tiene `_updated_at`: sin columna donde registrar una
     * modificación, el modelo no contempla que la haya. Es la misma señal que usa el propio
     * esquema —los logs y los eventos la omiten a propósito— y no depende de que alguien acierte
     * a llamar «_log» a su tabla.
     */
    await run(queryInterface, transaction, {
      sql: `
        INSERT INTO schema_tables (
          schema_version_id, table_name, table_type, is_append_only, is_tenant_scoped,
          description, created_by_platform_user_id, created_at, is_deleted, _created_at, _updated_at
        )
        SELECT
          :versionId,
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
          NULL, :createdAt, false, :createdAt, :createdAt
        FROM information_schema.tables t
        WHERE t.table_type = 'BASE TABLE'
          AND t.table_schema IN (${schemaList()})
          -- El propio catálogo y las tablas de tracking de migraciones quedan fuera: describirse a
          -- sí mismo no aporta gobierno y ensucia el inventario que se revisa.
          AND t.table_name NOT IN ('schema_versions', 'schema_tables', 'schema_columns', 'schema_relationships')
          AND t.table_name NOT LIKE '%migrations%'
          AND t.table_name NOT LIKE '%seeder%'
        ORDER BY t.table_schema, t.table_name
      `,
      replacements: { versionId, createdAt: CREATED_AT },
    });

    await run(queryInterface, transaction, {
      sql: `
        INSERT INTO schema_columns (
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
          c.column_name IN (${IMMUTABLE_COLUMNS.map((name) => `'${name}'`).join(', ')}),
          (${likeAny('c.column_name', PII_MARKERS)}),
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
          NULL, :createdAt, false, :createdAt, :createdAt
        FROM schema_tables st
        JOIN information_schema.columns c
          ON c.table_schema = split_part(st.table_name, '.', 1)
         AND c.table_name = split_part(st.table_name, '.', 2)
        WHERE st.schema_version_id = :versionId
        ORDER BY st._id, c.ordinal_position
      `,
      replacements: { versionId, createdAt: CREATED_AT },
    });

    /*
     * Las FK se copian con `is_immutable = true` SIEMPRE. No es una decisión de este seeder: es la
     * regla 1 del módulo («cambios de FK = nueva versión de schema»), y `validateRelationshipEdit`
     * ya rechaza cualquier edición. Sembrarlas como mutables contradiría al validador.
     */
    await run(queryInterface, transaction, {
      sql: `
        INSERT INTO schema_relationships (
          schema_version_id, source_table_id, source_column_name, target_table_id, target_column_name,
          cascade_delete, is_immutable, created_by_platform_user_id, created_at, _created_at
        )
        SELECT
          :versionId, source._id, kcu.column_name, target._id, target_col.column_name,
          rc.delete_rule = 'CASCADE', true, NULL, :createdAt, :createdAt
        FROM information_schema.table_constraints tc
        JOIN information_schema.key_column_usage kcu
          ON kcu.constraint_name = tc.constraint_name AND kcu.constraint_schema = tc.constraint_schema
        JOIN information_schema.referential_constraints rc
          ON rc.constraint_name = tc.constraint_name AND rc.constraint_schema = tc.constraint_schema
        JOIN information_schema.key_column_usage target_col
          ON target_col.constraint_name = rc.unique_constraint_name
         AND target_col.constraint_schema = rc.unique_constraint_schema
         AND target_col.ordinal_position = kcu.position_in_unique_constraint
        JOIN schema_tables source
          ON source.schema_version_id = :versionId
         AND source.table_name = tc.table_schema || '.' || tc.table_name
        JOIN schema_tables target
          ON target.schema_version_id = :versionId
         AND target.table_name = target_col.table_schema || '.' || target_col.table_name
        WHERE tc.constraint_type = 'FOREIGN KEY'
          AND tc.table_schema IN (${schemaList()})
      `,
      replacements: { versionId, createdAt: CREATED_AT },
    });

    await transaction.commit();
  } catch (error) {
    await transaction.rollback();
    throw error;
  }
}

export async function down({ context: queryInterface }: { context: QueryInterface }): Promise<void> {
  const transaction = await queryInterface.sequelize.transaction();
  try {
    // Se revierte solo lo sembrado por ESTA fecha: si alguien propuso tablas por el portal después,
    // sus filas llevan otra marca y no deben desaparecer al deshacer un seeder de inventario.
    await run(queryInterface, transaction, {
      sql: `DELETE FROM schema_relationships WHERE created_at = :createdAt`,
      replacements: { createdAt: CREATED_AT },
    });
    await run(queryInterface, transaction, {
      sql: `DELETE FROM schema_columns WHERE created_at = :createdAt`,
      replacements: { createdAt: CREATED_AT },
    });
    await run(queryInterface, transaction, {
      sql: `DELETE FROM schema_tables WHERE created_at = :createdAt`,
      replacements: { createdAt: CREATED_AT },
    });
    await transaction.commit();
  } catch (error) {
    await transaction.rollback();
    throw error;
  }
}
