/**
 * Escribe en `system_data_entity_catalog` la narrativa de gobierno curada a mano.
 *
 * Responde por tabla las cinco preguntas que ningún proceso puede inferir del `information_schema`
 * —por qué existe, por qué no se borra, qué decide, un ejemplo real y cómo funciona por dentro— y
 * que son la diferencia entre un catálogo con metadata de ESQUEMA y uno con metadata de NEGOCIO.
 *
 * Existía como seeder versionado (`20260727120000-seed-data-entity-business-narrative`) hasta que
 * las semillas salieron del repositorio a una rama de Neon. El resultado medible fue que la
 * narrativa dejó de reaplicarse: en la base de dev solo 153 de 413 fichas la tenían, y ninguna de
 * las tablas dadas de alta después. La lógica se conserva aquí, palabra por palabra, para que
 * volver a aplicarla no dependa de un artefacto que ya no se compila desde el código fuente.
 *
 * Es idempotente: upsert sobre la clave natural (`schema_name`, `table_name`).
 *
 * Uso (desde JavaScript compilado, ver `scripts/check-nest-entrypoints.ts`):
 *   node dist/scripts/apply-entity-business-narratives.js
 */
import { NestFactory } from '@nestjs/core';
import { QueryTypes } from 'sequelize';
import { Sequelize } from 'sequelize-typescript';
import { ATLAS_SCHEMAS } from '../src/database/domain-schemas.js';
import { ENTITY_BUSINESS_NARRATIVES, ENTITY_NARRATIVE_BY_TABLE } from '../src/modules/systems-ops/entity-narratives/index.js';

const ENTITY_CATALOG = `${ATLAS_SCHEMAS.PLATFORM_OPS}.system_data_entity_catalog`;
const NARRATIVE_SOURCE = 'CURATED';

/**
 * Bloque del ecosistema al que pertenecen estas tablas.
 *
 * El catálogo federa tres bloques (`ATLAS_BACKEND`, `DECISION_ENGINE`, `ERP_BACKEND`) y su clave
 * única es `(system_code, schema_name, table_name)`, no el par de antes: la migración
 * `20260820120000-add-platform-block-to-systems-catalog` la amplió. El seeder original seguía
 * apuntando al par y desde entonces fallaba con «no unique or exclusion constraint matching the
 * ON CONFLICT specification» — una segunda razón, además de haber salido del repositorio, por la
 * que la narrativa dejó de reaplicarse. Las narrativas describen tablas propias de este backend,
 * así que el bloque es fijo: escribirlas sin acotarlo pisaría la ficha homónima de otro bloque.
 */
const OWN_SYSTEM_CODE = 'ATLAS_BACKEND';

/**
 * Módulo de negocio por schema. Es la agrupación con la que el portal presenta el catálogo y con
 * la que el mapa de dominios del linaje junta las fichas.
 *
 * Cubre los QUINCE schemas de `ATLAS_SCHEMAS`, no once. El seeder original se escribió antes de
 * que existieran `credit`, `support`, `partner` y `expedientes`, y el `?? 'systems'` del final los
 * habría archivado a todos bajo «Systems Ops» —incluida la cartera de crédito—, que es peor que no
 * clasificarlos: una agrupación equivocada no se ve como un hueco, se ve como un hecho.
 */
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
  [ATLAS_SCHEMAS.CREDIT]: 'credit',
  [ATLAS_SCHEMAS.SUPPORT]: 'support',
  [ATLAS_SCHEMAS.PARTNER]: 'partner_onboarding',
  [ATLAS_SCHEMAS.EXPEDIENTES]: 'expedientes',
};

function humanize(tableName: string): string {
  return tableName
    .split('_')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

/**
 * Objetos físicos (tablas y vistas) de los schemas de Atlas, indexados por nombre.
 *
 * El schema NO se toma de `ATLAS_DOMAIN_TABLES` sino de la base real, porque el catálogo también
 * incluye objetos fuera de ese mapa (la vista `audit_event_feed`, las tablas que carga el loader de
 * contexto). Resolver contra la base evita escribir narrativa sobre un `schema_name` inexistente,
 * que al reaplicar produciría una segunda fila para la misma tabla física.
 */
async function resolvePhysicalObjects(sequelize: Sequelize): Promise<Map<string, string>> {
  const rows = await sequelize.query<{ table_schema: string; table_name: string }>(
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
 * algunas filas todavía dicen `public`. Sin este paso el upsert no encuentra la fila vieja y crea
 * una SEGUNDA para la misma tabla física — el duplicado que el catálogo existe para evitar. Solo
 * mueve la fila cuando su schema declarado ya no contiene el objeto Y el destino está libre.
 */
async function realignStaleSchemas(sequelize: Sequelize, physical: Map<string, string>): Promise<string[]> {
  const conflicts: string[] = [];
  const seededAt = new Date();
  for (const [tableName, schemaName] of physical) {
    if (!ENTITY_NARRATIVE_BY_TABLE.has(tableName)) continue;
    const [moved] = await sequelize.query<{ schema_name: string }>(
      `UPDATE ${ENTITY_CATALOG} AS target
          SET schema_name = :schemaName, _updated_at = :seededAt
        WHERE target.table_name = :tableName
          AND target.system_code = :systemCode
          AND target.schema_name <> :schemaName
          AND NOT EXISTS (
            SELECT 1 FROM information_schema.tables t
             WHERE t.table_schema = target.schema_name AND t.table_name = target.table_name
          )
          AND NOT EXISTS (
            SELECT 1 FROM ${ENTITY_CATALOG} existing
             WHERE existing.system_code = :systemCode
               AND existing.schema_name = :schemaName AND existing.table_name = :tableName
          )
      RETURNING target.schema_name;`,
      { replacements: { schemaName, tableName, seededAt, systemCode: OWN_SYSTEM_CODE }, type: QueryTypes.SELECT },
    );
    if (moved) continue;
    const stale = await sequelize.query<{ schema_name: string }>(
      `SELECT c.schema_name
         FROM ${ENTITY_CATALOG} c
         LEFT JOIN information_schema.tables t
           ON t.table_schema = c.schema_name AND t.table_name = c.table_name
        WHERE c.table_name = :tableName AND c.system_code = :systemCode AND t.table_name IS NULL;`,
      { replacements: { tableName, systemCode: OWN_SYSTEM_CODE }, type: QueryTypes.SELECT },
    );
    for (const row of stale) conflicts.push(`${row.schema_name}.${tableName}`);
  }
  return conflicts;
}

async function applyNarratives(sequelize: Sequelize): Promise<{ written: number; missing: string[]; conflicts: string[] }> {
  const physical = await resolvePhysicalObjects(sequelize);
  const conflicts = await realignStaleSchemas(sequelize, physical);
  const missing: string[] = [];
  const seededAt = new Date();
  let written = 0;

  for (const narrative of ENTITY_BUSINESS_NARRATIVES) {
    const schemaName = physical.get(narrative.tableName);
    if (!schemaName) {
      // La narrativa describe una tabla que este ambiente todavía no tiene (migración pendiente o
      // funcionalidad no desplegada). Se omite en vez de inventar una ficha sin objeto real.
      missing.push(narrative.tableName);
      continue;
    }
    /*
     * El `module` también se reescribe al reaplicar, no solo al insertar.
     *
     * El catálogo automático clasifica por heurística sobre el nombre de la tabla y produce
     * etiquetas como `runtime`, `operations` o directamente `sin-clasificar`; el mapa de dominios
     * del linaje agrupa por ese valor, así que una ficha mal clasificada aparece bajo un dominio
     * que no es el suyo. Aquí el módulo sale del schema, que es una decisión de arquitectura ya
     * tomada y no una inferencia sobre un nombre.
     */
    await sequelize.query(
      `INSERT INTO ${ENTITY_CATALOG} (
         system_code, schema_name, table_name, entity_name, module, business_purpose,
         business_why_exists, business_why_not_delete, business_decision_contribution,
         business_usage_example, systems_explanation, narrative_source, narrative_updated_at,
         _created_at, _updated_at
       ) VALUES (
         :systemCode, :schemaName, :tableName, :entityName, :module, :businessPurpose,
         :whyExists, :whyNotDelete, :decisionContribution,
         :usageExample, :systemsExplanation, :narrativeSource, :seededAt,
         :seededAt, :seededAt
       )
       ON CONFLICT (system_code, schema_name, table_name) DO UPDATE SET
         entity_name = EXCLUDED.entity_name,
         module = EXCLUDED.module,
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
          systemCode: OWN_SYSTEM_CODE,
          schemaName,
          tableName: narrative.tableName,
          entityName: humanize(narrative.tableName),
          module: SCHEMA_MODULE[schemaName] ?? 'systems',
          businessPurpose: narrative.whyExists,
          whyExists: narrative.whyExists,
          whyNotDelete: narrative.whyNotDelete,
          decisionContribution: narrative.decisionContribution,
          usageExample: narrative.usageExample,
          systemsExplanation: narrative.systemsExplanation,
          narrativeSource: NARRATIVE_SOURCE,
          seededAt,
        },
      },
    );
    written += 1;
  }
  return { written, missing, conflicts };
}

async function main(): Promise<void> {
  const { AppModule } = await import('../src/app.module.js');
  const context = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'], abortOnError: false });
  try {
    const result = await applyNarratives(context.get(Sequelize));
    console.log(`✅ Narrativa de negocio aplicada a ${result.written} entidades del catálogo.`);
    if (result.missing.length > 0) {
      console.log(`   ${result.missing.length} tabla(s) con narrativa pero sin objeto físico aquí: ${result.missing.join(', ')}`);
    }
    if (result.conflicts.length > 0) {
      console.warn(`   ⚠️  Fichas apuntando a un schema inexistente que NO se pudieron realinear: ${result.conflicts.join(', ')}`);
    }
  } finally {
    await context.close();
  }
}

main().catch((error: unknown) => {
  console.error('❌ No se pudo aplicar la narrativa de negocio al catálogo.', error);
  process.exit(1);
});
