/**
 * Escribe en el catálogo de plataforma los DOS artefactos de negocio curados a mano que hasta
 * ahora vivían en el código sin que nadie los leyera.
 *
 * 1. **Dominios de negocio** (`system_domain_catalog`). La tabla estaba vacía, así que el «Mapa por
 *    dominio» del linaje caía siempre en «módulo sin dominio de negocio asociado»: la pantalla
 *    agrupaba por el `module` heurístico del catálogo automático y no tenía contra qué resolverlo.
 *    Los quince dominios de `DOMAIN_BUSINESS_METADATA` traen definición de negocio, alcance
 *    técnico, equipo dueño, notas regulatorias y casos de uso de decisión — precisamente lo que
 *    ningún escaneo de `information_schema` puede inventar.
 *
 * 2. **Relaciones lógicas** (`system_data_relationship_catalog`). La introspección de FKs solo ve
 *    integridad referencial declarada; una relación que el negocio sostiene en la capa de servicio
 *    —porque cruza esquemas, porque es polimórfica o porque la FK se omitió a propósito— no existe
 *    para ella. `LOGICAL_RELATIONSHIP_METADATA` las nombra con su razón de negocio.
 *
 * Ambas son idempotentes: la de dominios por `domain_code`, la de relaciones buscando primero por
 * su clave natural (esquema, tabla y tipo en los dos extremos) antes de insertar.
 *
 * Uso (desde JavaScript compilado, ver `scripts/check-nest-entrypoints.ts`):
 *   node dist/scripts/apply-curated-business-metadata.js
 */
import { NestFactory } from '@nestjs/core';
import { QueryTypes } from 'sequelize';
import { Sequelize } from 'sequelize-typescript';
import { ATLAS_SCHEMAS } from '../src/database/domain-schemas.js';
import { DOMAIN_BUSINESS_METADATA, LOGICAL_RELATIONSHIP_METADATA } from '../src/modules/systems-ops/systems-business-metadata.fixtures.js';

const DOMAIN_CATALOG = `${ATLAS_SCHEMAS.PLATFORM_OPS}.system_domain_catalog`;
const RELATIONSHIP_CATALOG = `${ATLAS_SCHEMAS.PLATFORM_OPS}.system_data_relationship_catalog`;
const ENTITY_CATALOG = `${ATLAS_SCHEMAS.PLATFORM_OPS}.system_data_entity_catalog`;

/**
 * Atlas opera hoy en Bolivia y la partición por tenant existe para escalar a otros mercados sin
 * mezclar datos ni reglas. Se declara el país explícitamente en vez de dejar el arreglo vacío:
 * «sin países» y «todos los países» se ven igual y significan lo contrario.
 */
const COUNTRIES_APPLICABLE = ['BO'];

/**
 * Bloque del ecosistema propio. El catálogo federa tres (`ATLAS_BACKEND`, `DECISION_ENGINE`,
 * `ERP_BACKEND`) y hay nombres de tabla que se repiten entre ellos, así que resolver una ficha sin
 * acotar el bloque puede enlazar la relación —o poner el dueño— sobre la tabla de otro sistema.
 */
const OWN_SYSTEM_CODE = 'ATLAS_BACKEND';

async function seedDomains(sequelize: Sequelize): Promise<number> {
  const now = new Date();
  for (const domain of DOMAIN_BUSINESS_METADATA) {
    await sequelize.query(
      `INSERT INTO ${DOMAIN_CATALOG} (
         domain_code, domain_name, description, business_definition, technical_scope,
         data_nature, owner_team, countries_applicable, regulatory_notes, example_tables,
         decision_use_cases, audit_relevance, status, _created_at, _updated_at
       ) VALUES (
         :domainCode, :domainName, :description, :businessDefinition, :technicalScope,
         :dataNature, :ownerTeam, CAST(:countries AS jsonb), :regulatoryNotes, CAST(:exampleTables AS jsonb),
         CAST(:decisionUseCases AS jsonb), :auditRelevance, 'ACTIVE', :now, :now
       )
       ON CONFLICT (domain_code) DO UPDATE SET
         domain_name = EXCLUDED.domain_name,
         description = EXCLUDED.description,
         business_definition = EXCLUDED.business_definition,
         technical_scope = EXCLUDED.technical_scope,
         data_nature = EXCLUDED.data_nature,
         owner_team = EXCLUDED.owner_team,
         countries_applicable = EXCLUDED.countries_applicable,
         regulatory_notes = EXCLUDED.regulatory_notes,
         example_tables = EXCLUDED.example_tables,
         decision_use_cases = EXCLUDED.decision_use_cases,
         audit_relevance = EXCLUDED.audit_relevance,
         _updated_at = EXCLUDED._updated_at;`,
      {
        replacements: {
          domainCode: domain.domainCode,
          domainName: domain.domainName,
          description: domain.description,
          businessDefinition: domain.businessDefinition,
          technicalScope: domain.technicalScope,
          dataNature: domain.dataNature,
          ownerTeam: domain.ownerTeam,
          countries: JSON.stringify(COUNTRIES_APPLICABLE),
          regulatoryNotes: domain.regulatoryNotes,
          exampleTables: JSON.stringify(domain.exampleTables),
          decisionUseCases: JSON.stringify(domain.decisionUseCases),
          auditRelevance: domain.auditRelevance,
          now,
        },
      },
    );
  }
  return DOMAIN_BUSINESS_METADATA.length;
}

/** Schema físico por nombre de tabla, resuelto contra la base y no contra un mapa en código. */
async function resolveSchemas(sequelize: Sequelize): Promise<Map<string, string>> {
  const rows = await sequelize.query<{ table_schema: string; table_name: string }>(
    `SELECT table_schema, table_name
       FROM information_schema.tables
      WHERE table_schema IN (:schemas)
      ORDER BY table_schema, table_name;`,
    { replacements: { schemas: Object.values(ATLAS_SCHEMAS) }, type: QueryTypes.SELECT },
  );
  const bySchema = new Map<string, string>();
  for (const row of rows) if (!bySchema.has(row.table_name)) bySchema.set(row.table_name, row.table_schema);
  return bySchema;
}

async function findEntityId(sequelize: Sequelize, schemaName: string, tableName: string): Promise<string | null> {
  const [row] = await sequelize.query<{ id: string }>(
    `SELECT _id::text AS id
       FROM ${ENTITY_CATALOG}
      WHERE system_code = :systemCode AND schema_name = :schemaName AND table_name = :tableName
      LIMIT 1;`,
    { replacements: { systemCode: OWN_SYSTEM_CODE, schemaName, tableName }, type: QueryTypes.SELECT },
  );
  return row?.id ?? null;
}

async function seedLogicalRelationships(sequelize: Sequelize): Promise<{ written: number; skipped: string[] }> {
  const schemas = await resolveSchemas(sequelize);
  const skipped: string[] = [];
  const now = new Date();
  let written = 0;

  for (const relation of LOGICAL_RELATIONSHIP_METADATA) {
    const sourceSchema = schemas.get(relation.sourceTable);
    const targetSchema = schemas.get(relation.targetTable);
    if (!sourceSchema || !targetSchema) {
      // Una de las dos tablas no existe en este ambiente. Se omite en vez de escribir una arista
      // hacia un extremo inexistente, que el grafo tendría que descartar después en silencio.
      skipped.push(`${relation.sourceTable} → ${relation.targetTable}`);
      continue;
    }
    const [existing] = await sequelize.query<{ id: string }>(
      `SELECT _id::text AS id
         FROM ${RELATIONSHIP_CATALOG}
        WHERE source_schema = :sourceSchema AND source_table = :sourceTable
          AND target_schema = :targetSchema AND target_table = :targetTable
          AND relationship_type = :relationshipType
          AND COALESCE(source_column, '') = '' AND COALESCE(target_column, '') = ''
        LIMIT 1;`,
      {
        replacements: {
          sourceSchema,
          sourceTable: relation.sourceTable,
          targetSchema,
          targetTable: relation.targetTable,
          relationshipType: relation.relationshipType,
        },
        type: QueryTypes.SELECT,
      },
    );

    const replacements = {
      sourceDataEntityId: await findEntityId(sequelize, sourceSchema, relation.sourceTable),
      targetDataEntityId: await findEntityId(sequelize, targetSchema, relation.targetTable),
      sourceSchema,
      sourceTable: relation.sourceTable,
      targetSchema,
      targetTable: relation.targetTable,
      relationshipType: relation.relationshipType,
      cardinality: relation.cardinality ?? 'N:N',
      optionality: relation.optionality ?? 'OPTIONAL',
      businessReason: relation.businessReason,
      technicalReason: relation.technicalReason,
      auditUsage: relation.auditUsage,
      analysisUsage: relation.analysisUsage,
      decisionUsage: relation.decisionUsage,
      now,
      id: existing?.id ?? null,
    };

    if (existing) {
      await sequelize.query(
        `UPDATE ${RELATIONSHIP_CATALOG}
            SET source_data_entity_id = :sourceDataEntityId,
                target_data_entity_id = :targetDataEntityId,
                cardinality = :cardinality,
                optionality = :optionality,
                business_reason = :businessReason,
                technical_reason = :technicalReason,
                audit_usage = :auditUsage,
                analysis_usage = :analysisUsage,
                decision_usage = :decisionUsage,
                _updated_at = :now
          WHERE _id = :id;`,
        { replacements },
      );
      written += 1;
      continue;
    }

    await sequelize.query(
      `INSERT INTO ${RELATIONSHIP_CATALOG} (
         source_data_entity_id, target_data_entity_id, source_schema, source_table, source_column,
         target_schema, target_table, target_column, relationship_type, cardinality, optionality,
         business_reason, technical_reason, audit_usage, analysis_usage, decision_usage,
         enforcement_strategy, delete_policy, source_document, confidence_level, review_status,
         _created_at, _updated_at
       ) VALUES (
         :sourceDataEntityId, :targetDataEntityId, :sourceSchema, :sourceTable, NULL,
         :targetSchema, :targetTable, NULL, :relationshipType, :cardinality, :optionality,
         :businessReason, :technicalReason, :auditUsage, :analysisUsage, :decisionUsage,
         'SERVICE_LAYER_INVARIANT', 'RESTRICT_OR_SOFT_DELETE', 'curated_business_metadata',
         'HIGH', 'APPROVED', :now, :now
       );`,
      { replacements },
    );
    written += 1;
  }
  return { written, skipped };
}

/**
 * Pone dueño real a las fichas que un dominio nombra explícitamente entre sus `exampleTables`.
 *
 * El catálogo automático escribe `data_owner = 'systems'` en TODAS: un campo relleno que no dice
 * nada y que además es falso —soporte no lo lleva sistemas—. Aquí el dueño sale de una lista
 * escrita a mano por negocio, no de una inferencia sobre el nombre de la tabla, y por eso solo
 * alcanza a las tablas que esa lista nombra. Las demás se quedan como están: poner un dueño
 * adivinado sería el mismo problema con otra etiqueta.
 *
 * Una tabla puede aparecer en dos dominios (`attribute_definitions` está en riesgo de crédito y en
 * capacidad de pago). Si ambos comparten equipo, no hay conflicto; si no, se omite y se reporta,
 * porque elegir uno de los dos sería inventar la respuesta a una pregunta que es de negocio.
 */
async function assignDataOwners(sequelize: Sequelize): Promise<{ assigned: number; ambiguous: string[] }> {
  const ownersByTable = new Map<string, Set<string>>();
  for (const domain of DOMAIN_BUSINESS_METADATA) {
    for (const table of domain.exampleTables) {
      const owners = ownersByTable.get(table) ?? new Set<string>();
      owners.add(domain.ownerTeam);
      ownersByTable.set(table, owners);
    }
  }

  const ambiguous: string[] = [];
  const now = new Date();
  let assigned = 0;
  for (const [tableName, owners] of ownersByTable) {
    if (owners.size > 1) {
      ambiguous.push(`${tableName} (${[...owners].join(' / ')})`);
      continue;
    }
    const [ownerTeam] = [...owners];
    // `RETURNING` + `SELECT` en vez de leer el conteo del metadata del UPDATE: en Postgres ese
    // segundo elemento no es un número, así que el script decía «0 fichas con dueño» mientras las
    // estaba escribiendo. Un informe que miente sobre su propio efecto es peor que no informar.
    const updated = await sequelize.query<{ id: string }>(
      `UPDATE ${ENTITY_CATALOG}
          SET data_owner = :ownerTeam, _updated_at = :now
        WHERE table_name = :tableName
          AND system_code = :systemCode
          AND COALESCE(data_owner, '') <> :ownerTeam
      RETURNING _id::text AS id;`,
      { replacements: { ownerTeam, tableName, now, systemCode: OWN_SYSTEM_CODE }, type: QueryTypes.SELECT },
    );
    assigned += updated.length;
  }
  return { assigned, ambiguous };
}

async function main(): Promise<void> {
  const { AppModule } = await import('../src/app.module.js');
  const context = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'], abortOnError: false });
  try {
    const sequelize = context.get(Sequelize);
    const domains = await seedDomains(sequelize);
    const relations = await seedLogicalRelationships(sequelize);
    const owners = await assignDataOwners(sequelize);
    console.log(
      `✅ ${domains} dominios de negocio, ${relations.written} relaciones lógicas y ${owners.assigned} ficha(s) con dueño real aplicadas al catálogo.`,
    );
    if (owners.ambiguous.length > 0) {
      console.log(`   ${owners.ambiguous.length} tabla(s) reclamadas por dominios con dueños distintos: ${owners.ambiguous.join('; ')}`);
    }
    if (relations.skipped.length > 0) {
      console.log(`   ${relations.skipped.length} relación(es) omitida(s) por tabla ausente aquí: ${relations.skipped.join('; ')}`);
    }
  } finally {
    await context.close();
  }
}

main().catch((error: unknown) => {
  console.error('❌ No se pudo aplicar la metadata de negocio curada.', error);
  process.exit(1);
});
