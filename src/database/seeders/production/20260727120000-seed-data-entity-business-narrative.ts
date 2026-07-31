/**
 * @file Migración reversible: evoluciona el esquema PostgreSQL en orden.
 * @business Esta pieza preserva la fuente de verdad y la evidencia histórica que soportan decisiones y cumplimiento.
 * @system define production para evolucionar, mapear, sembrar o consultar PostgreSQL de forma controlada.
 */
import { QueryInterface, QueryTypes } from 'sequelize';
import { ATLAS_SCHEMAS } from '../../domain-schemas.js';
import { ENTITY_BUSINESS_NARRATIVES, ENTITY_NARRATIVE_BY_TABLE } from '../../../modules/systems-ops/entity-narratives/index.js';

type SeedContext = { context: QueryInterface };

/**
 * Resiembra de la narrativa de gobierno de `system_data_entity_catalog`.
 *
 * Vive en el perfil `production` (no en `demo`) porque NO es dato ficticio: describe el modelo de
 * datos real y debe existir en todos los ambientes. El seeder es idempotente por construcción —
 * upsert sobre la clave natural (`schema_name`, `table_name`) — así que volver a correrlo deja el
 * mismo estado y `db:seed:verify-prod-idempotency` pasa.
 *
 * El schema NO se toma de `ATLAS_DOMAIN_TABLES` sino del `information_schema` real, porque el
 * catálogo también incluye objetos que no están en ese mapa (la vista `audit_event_feed`, las
 * tablas de `catalog` cargadas por el loader de contexto). Resolver contra la base evita sembrar
 * narrativa sobre un `schema_name` que no existe, que produciría filas duplicadas al reseedear.
 */
const ENTITY_CATALOG = `${ATLAS_SCHEMAS.PLATFORM_OPS}.system_data_entity_catalog`;
const NARRATIVE_SOURCE = 'CURATED';
const SEEDED_AT = new Date('2026-07-27T12:00:00.000Z');

type ObjectRow = { table_schema: string; table_name: string };

const SCHEMA_MODULE: Record<string, string> = {
  [ATLAS_SCHEMAS.IAM]: 'iam',
  [ATLAS_SCHEMAS.CUSTOMER]: 'customers',
  [ATLAS_SCHEMAS.PRIVACY]: 'privacy',
  [ATLAS_SCHEMAS.TELEMETRY]: 'device-intelligence',
  [ATLAS_SCHEMAS.CATALOG]: 'catalog-management',
  [ATLAS_SCHEMAS.RISK]: 'risk',
  [ATLAS_SCHEMAS.CASE_MANAGEMENT]: 'fraud',
  [ATLAS_SCHEMAS.AUDIT]: 'audit',
  [ATLAS_SCHEMAS.INTEGRATIONS]: 'external-data',
  [ATLAS_SCHEMAS.MESSAGING]: 'notifications',
  [ATLAS_SCHEMAS.PLATFORM_OPS]: 'systems',
};

function humanize(tableName: string): string {
  return tableName
    .split('_')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

/** Objetos físicos (tablas y vistas) de los schemas de Atlas, indexados por nombre. */
async function resolvePhysicalObjects(queryInterface: QueryInterface): Promise<Map<string, string>> {
  const rows = await queryInterface.sequelize.query<ObjectRow>(
    `SELECT table_schema, table_name
       FROM information_schema.tables
      WHERE table_schema IN (:schemas)
      ORDER BY table_schema, table_name;`,
    { replacements: { schemas: Object.values(ATLAS_SCHEMAS) }, type: QueryTypes.SELECT },
  );

  const bySchema = new Map<string, string>();
  for (const row of rows) {
    // Un mismo nombre en dos schemas de dominio sería un error de layout que ya cubre
    // `check:domain-schema-layout`; aquí basta con quedarse con el primero de forma determinista.
    if (!bySchema.has(row.table_name)) bySchema.set(row.table_name, row.table_schema);
  }
  return bySchema;
}

/**
 * Realinea filas del catálogo que quedaron apuntando a un `schema_name` obsoleto.
 *
 * El catálogo se pobló antes de `20260717120000-split-write-model-into-domain-schemas`, así que
 * algunas filas todavía dicen `public`. Sin este paso, el upsert por (`schema_name`, `table_name`)
 * no encuentra la fila vieja y crea una SEGUNDA fila para la misma tabla física — exactamente el
 * duplicado que el catálogo existe para evitar. Solo mueve la fila cuando su schema declarado ya no
 * contiene el objeto Y el destino está libre; si ambas filas existen, no toca nada y lo reporta.
 */
async function realignStaleSchemas(queryInterface: QueryInterface, physical: Map<string, string>): Promise<string[]> {
  const conflicts: string[] = [];
  for (const [tableName, schemaName] of physical) {
    if (!ENTITY_NARRATIVE_BY_TABLE.has(tableName)) continue;
    const [result] = await queryInterface.sequelize.query<{ schema_name: string }>(
      `UPDATE ${ENTITY_CATALOG} AS target
          SET schema_name = :schemaName, _updated_at = :seededAt
        WHERE target.table_name = :tableName
          AND target.schema_name <> :schemaName
          AND NOT EXISTS (
            SELECT 1 FROM information_schema.tables t
             WHERE t.table_schema = target.schema_name AND t.table_name = target.table_name
          )
          AND NOT EXISTS (
            SELECT 1 FROM ${ENTITY_CATALOG} existing
             WHERE existing.schema_name = :schemaName AND existing.table_name = :tableName
          )
      RETURNING target.schema_name;`,
      { replacements: { schemaName, tableName, seededAt: SEEDED_AT }, type: QueryTypes.SELECT },
    );
    if (result) continue;

    const stale = await queryInterface.sequelize.query<{ schema_name: string }>(
      `SELECT c.schema_name
         FROM ${ENTITY_CATALOG} c
         LEFT JOIN information_schema.tables t
           ON t.table_schema = c.schema_name AND t.table_name = c.table_name
        WHERE c.table_name = :tableName AND t.table_name IS NULL;`,
      { replacements: { tableName }, type: QueryTypes.SELECT },
    );
    for (const row of stale) conflicts.push(`${row.schema_name}.${tableName}`);
  }
  return conflicts;
}

export async function up({ context: queryInterface }: SeedContext): Promise<void> {
  const physical = await resolvePhysicalObjects(queryInterface);
  const staleConflicts = await realignStaleSchemas(queryInterface, physical);
  const missingObjects: string[] = [];
  let written = 0;

  for (const narrative of ENTITY_BUSINESS_NARRATIVES) {
    const schemaName = physical.get(narrative.tableName);
    if (!schemaName) {
      // La narrativa describe una tabla que este ambiente todavía no tiene (migración pendiente o
      // feature no desplegada). Se omite en vez de inventar una fila de catálogo sin objeto real.
      missingObjects.push(narrative.tableName);
      continue;
    }

    await queryInterface.sequelize.query(
      `INSERT INTO ${ENTITY_CATALOG} (
         schema_name, table_name, entity_name, module, business_purpose,
         business_why_exists, business_why_not_delete, business_decision_contribution,
         business_usage_example, systems_explanation, narrative_source, narrative_updated_at,
         _created_at, _updated_at
       ) VALUES (
         :schemaName, :tableName, :entityName, :module, :businessPurpose,
         :whyExists, :whyNotDelete, :decisionContribution,
         :usageExample, :systemsExplanation, :narrativeSource, :seededAt,
         :seededAt, :seededAt
       )
       ON CONFLICT (schema_name, table_name) DO UPDATE SET
         business_why_exists = EXCLUDED.business_why_exists,
         business_why_not_delete = EXCLUDED.business_why_not_delete,
         business_decision_contribution = EXCLUDED.business_decision_contribution,
         business_usage_example = EXCLUDED.business_usage_example,
         systems_explanation = EXCLUDED.systems_explanation,
         narrative_source = EXCLUDED.narrative_source,
         narrative_updated_at = EXCLUDED.narrative_updated_at,
         _updated_at = EXCLUDED.narrative_updated_at;`,
      {
        replacements: {
          schemaName,
          tableName: narrative.tableName,
          entityName: humanize(narrative.tableName),
          module: SCHEMA_MODULE[schemaName] ?? 'systems',
          // Solo aplica en INSERT (fila que el catálogo automático todavía no había detectado):
          // el DO UPDATE deliberadamente NO toca `business_purpose` para no pisar lo que ya
          // escribió el seeder de metadata rica ni una edición manual del portal.
          businessPurpose: narrative.whyExists,
          whyExists: narrative.whyExists,
          whyNotDelete: narrative.whyNotDelete,
          decisionContribution: narrative.decisionContribution,
          usageExample: narrative.usageExample,
          systemsExplanation: narrative.systemsExplanation,
          narrativeSource: NARRATIVE_SOURCE,
          seededAt: SEEDED_AT,
        },
      },
    );
    written += 1;
  }

  // Evidencia de cobertura: sin esto, un catálogo a medio documentar se ve igual que uno completo.
  const uncovered = await queryInterface.sequelize.query<{ table_name: string }>(
    `SELECT table_name FROM ${ENTITY_CATALOG} WHERE narrative_source IS NULL ORDER BY table_name;`,
    { type: QueryTypes.SELECT },
  );

  console.log(
    `[seed:entity-narrative] ${written}/${ENTITY_BUSINESS_NARRATIVES.length} narrativas escritas. ` +
      `Sin objeto físico en este ambiente: ${missingObjects.length ? missingObjects.join(', ') : 'ninguna'}. ` +
      `Filas de catálogo con schema obsoleto no realineables: ${staleConflicts.length ? staleConflicts.join(', ') : 'ninguna'}. ` +
      `Entidades catalogadas sin narrativa: ${uncovered.length ? uncovered.map((row) => row.table_name).join(', ') : 'ninguna'}.`,
  );
}

export async function down({ context: queryInterface }: SeedContext): Promise<void> {
  // Solo limpia lo que sembró este seeder (`CURATED`); una narrativa editada a mano y marcada de
  // otra forma no se toca. No borra filas: el catálogo de entidades lo gobierna otro proceso.
  await queryInterface.sequelize.query(
    `UPDATE ${ENTITY_CATALOG}
        SET business_why_exists = NULL,
            business_why_not_delete = NULL,
            business_decision_contribution = NULL,
            business_usage_example = NULL,
            systems_explanation = NULL,
            narrative_source = NULL,
            narrative_updated_at = NULL
      WHERE narrative_source = :narrativeSource
        AND table_name IN (:tableNames);`,
    { replacements: { narrativeSource: NARRATIVE_SOURCE, tableNames: [...ENTITY_NARRATIVE_BY_TABLE.keys()] } },
  );
}
