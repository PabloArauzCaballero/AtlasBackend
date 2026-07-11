import { ConflictException, Injectable } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/sequelize';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { QueryTypes } from 'sequelize';
import { Sequelize } from 'sequelize-typescript';
import { SYSTEM_TOOL_SEEDS } from './systems-ops.constants.js';
import { EndpointDiscoveryService } from './endpoint-discovery.service.js';
import { SystemsCatalogClassifierService } from './systems-catalog-classifier.service.js';
import { SystemsCatalogRepository } from './systems-catalog.repository.js';
import { SystemsStressProfileRepository } from './systems-stress-profile.repository.js';
import { SystemsTestExecutionRepository } from './systems-test-execution.repository.js';
import { CURATED_ENDPOINTS, STRESS_PROFILE_SEEDS } from './systems-seed-fixtures.js';
import { SystemJobRunModel } from '../../database/models/index.js';
import { AuthenticatedUser } from '../../common/types/auth.types.js';
import { actorId } from './systems-actor.util.js';
import { systemsTenantScope } from './systems-tenant-scope.util.js';

type DocsImpact = { method: string; path: string; reads: string[]; writes: string[] };
type IntrospectedTable = { schemaName: string; tableName: string };
type IntrospectedColumn = IntrospectedTable & {
  columnName: string;
  ordinalPosition: number | null;
  sqlDataType: string | null;
  isNullable: boolean;
  columnDefault: string | null;
  isPrimaryKey: boolean;
  isForeignKey: boolean;
  referencedSchema: string | null;
  referencedTable: string | null;
  referencedColumn: string | null;
};

@Injectable()
export class SystemsCatalogSeedService {
  constructor(
    @InjectConnection() private readonly sequelize: Sequelize,
    private readonly catalogRepository: SystemsCatalogRepository,
    private readonly testRepository: SystemsTestExecutionRepository,
    private readonly stressRepository: SystemsStressProfileRepository,
    private readonly discovery: EndpointDiscoveryService,
    private readonly classifier: SystemsCatalogClassifierService,
    @InjectModel(SystemJobRunModel) private readonly jobRunModel: typeof SystemJobRunModel,
  ) {}

  async refreshCatalog(
    input: { includeTools: boolean; includeDataEntities: boolean; includeEndpointSeeds: boolean },
    user: AuthenticatedUser,
  ) {
    const lockTransaction = await this.sequelize.transaction();
    const [lock] = await this.sequelize.query<{ acquired: boolean }>(
      `SELECT pg_try_advisory_xact_lock(hashtext('atlas_systems_catalog_refresh')) AS acquired`,
      { type: QueryTypes.SELECT, transaction: lockTransaction },
    );
    if (!lock?.acquired) {
      await lockTransaction.rollback();
      throw new ConflictException('SYSTEMS_CATALOG_REFRESH_ALREADY_RUNNING');
    }
    const startedAt = new Date();
    const job = await this.jobRunModel.create({
      tenantId: systemsTenantScope(user),
      jobCode: 'systems_catalog_refresh',
      status: 'running',
      startedAt,
      inputJson: input,
      resultJson: null,
      errorMessage: null,
      triggeredByType: 'user',
      triggeredById: actorId(user),
      createdAtValue: startedAt,
    } as never);
    const result = {
      tools: 0,
      dataEntities: 0,
      columns: 0,
      relationships: 0,
      endpointSeeds: 0,
      discoveredEndpoints: 0,
      impacts: 0,
      suites: 0,
      stressProfiles: 0,
    };
    try {
      if (input.includeTools) result.tools = await this.seedTools();
      if (input.includeDataEntities) {
        result.dataEntities = await this.seedDataEntitiesFromModels();
        const columnSeed = await this.seedColumnsFromInformationSchema();
        result.columns = columnSeed.columns;
        result.relationships = columnSeed.relationships;
      }
      if (input.includeEndpointSeeds) {
        result.endpointSeeds = await this.seedCuratedEndpoints();
        const discovered = await this.discovery.discoverAndMaybePersist(true);
        result.discoveredEndpoints = discovered.persisted;
        result.impacts = await this.seedImpactsFromDocs();
        result.suites = await this.seedSuites();
        result.stressProfiles = await this.seedStressProfiles();
      }
      job.status = 'succeeded';
      job.completedAt = new Date();
      job.resultJson = result;
      await job.save();
      await lockTransaction.commit();
      return { jobRunId: String(job.id), ...result };
    } catch (error) {
      job.status = 'failed';
      job.completedAt = new Date();
      job.resultJson = result;
      job.errorMessage = error instanceof Error ? error.message.slice(0, 2000) : 'unknown_error';
      await job.save().catch(() => undefined);
      await lockTransaction.rollback().catch(() => undefined);
      throw error;
    }
  }

  async seedTools(): Promise<number> {
    for (const seed of SYSTEM_TOOL_SEEDS) await this.catalogRepository.upsertTool(seed);
    return SYSTEM_TOOL_SEEDS.length;
  }

  async seedDataEntitiesFromModels(): Promise<number> {
    const modelDir = join(process.cwd(), 'src', 'database', 'models');
    if (!existsSync(modelDir)) return 0;
    const files = readdirSync(modelDir).filter((file) => file.endsWith('.model.ts'));
    let count = 0;
    const seen = new Set<string>();
    for (const file of files) {
      const source = readFileSync(join(modelDir, file), 'utf8');
      const tableName = source.match(/@Table\(\{\s*tableName:\s*['"]([^'"]+)['"]/s)?.[1];
      const modelName = source.match(/export\s+class\s+([A-Za-z0-9_]+)/)?.[1] ?? null;
      if (!tableName || seen.has(tableName)) continue;
      await this.catalogRepository.upsertDataEntity(this.classifier.classifyTable(tableName, modelName));
      seen.add(tableName);
      count += 1;
    }
    return count;
  }

  async seedColumnsFromInformationSchema(): Promise<{ columns: number; relationships: number }> {
    const tables = await this.listDatabaseTables();
    for (const table of tables) {
      const existing = await this.catalogRepository.findDataEntityByTable(table.schemaName, table.tableName);
      if (!existing) {
        await this.catalogRepository.upsertDataEntity({
          ...this.classifier.classifyTable(table.tableName, null),
          schemaName: table.schemaName,
          detectedFrom: 'information_schema_enriched',
          confidenceLevel: 'MEDIUM',
        });
      }
    }

    const columns = await this.listDatabaseColumns();
    const activeKeys = new Set<string>();
    let relationshipCount = 0;
    for (const column of columns) {
      activeKeys.add(`${column.schemaName}.${column.tableName}.${column.columnName}`);
      await this.upsertCatalogColumn(column);
      if (column.isForeignKey && column.referencedTable && column.referencedColumn) {
        await this.upsertCatalogRelationship(column);
        relationshipCount += 1;
      }
    }
    await this.markMissingColumnsAsDeprecated(activeKeys);
    return { columns: columns.length, relationships: relationshipCount };
  }

  async seedCuratedEndpoints(): Promise<number> {
    for (const seed of CURATED_ENDPOINTS) await this.catalogRepository.upsertEndpoint(seed);
    return CURATED_ENDPOINTS.length;
  }

  async seedImpactsFromDocs(): Promise<number> {
    const docs = this.parseEndpointDocs();
    let count = 0;
    for (const doc of docs) {
      const endpoint = await this.catalogRepository.findEndpointByMethodAndPath(doc.method, doc.path);
      if (!endpoint) continue;
      for (const table of doc.reads) {
        if (await this.upsertImpactForTable(String(endpoint.id), table, 'READ', false)) count += 1;
      }
      for (const [index, table] of doc.writes.entries()) {
        if (await this.upsertImpactForTable(String(endpoint.id), table, 'INSERT', index === 0)) count += 1;
      }
    }
    return count;
  }

  async seedSuites(): Promise<number> {
    const smoke = await this.testRepository.upsertTestSuite({
      code: 'SMOKE_HEALTH_AND_DOCS',
      name: 'Smoke de salud y documentación',
      description: 'Verifica health y endpoints internos de solo lectura básicos.',
      module: 'systems',
      suiteType: 'SMOKE',
      environmentScope: ['LOCAL', 'STAGING', 'PRODUCTION_READONLY'],
      isSafeForProduction: true,
    });
    await this.testRepository.upsertTestStep({
      suiteId: String(smoke.id),
      endpointId: null,
      stepOrder: 1,
      name: 'Health',
      method: 'GET',
      pathTemplate: '/api/v1/health',
      extractors: { healthStatus: '$.body.status', databaseStatus: '$.body.database' },
      assertions: {
        expectedStatusCodes: [200],
        jsonPathExists: ['$.status', '$.service', '$.database', '$.timestamp'],
        jsonPathEquals: { '$.service': 'atlas-backend' },
        jsonPathType: { '$.uptime': 'number' },
        maxDurationMs: 2000,
      },
    });

    const operations = await this.testRepository.upsertTestSuite({
      code: 'OPERATIONS_WORK_QUEUE',
      name: 'Cola operativa',
      description: 'Verifica lectura interna de work queue para operaciones.',
      module: 'operations',
      suiteType: 'INTEGRATION',
      environmentScope: ['LOCAL', 'STAGING'],
    });
    const endpoint = await this.catalogRepository.findEndpointByMethodAndPath('GET', '/api/v1/operations/work-queue');
    await this.testRepository.upsertTestStep({
      suiteId: String(operations.id),
      endpointId: endpoint ? String(endpoint.id) : null,
      stepOrder: 1,
      name: 'Listar work queue',
      method: 'GET',
      pathTemplate: '/api/v1/operations/work-queue?queue={{config.queue}}&page=1&limit=20',
      inputMode: 'CONFIGURABLE',
      configSchema: { queue: { type: 'string', default: 'all' } },
      assertions: { expectedStatusCodes: [200], maxDurationMs: 2500 },
    });
    return 2;
  }

  async seedStressProfiles(): Promise<number> {
    let count = 0;
    for (const candidate of STRESS_PROFILE_SEEDS) {
      const endpoint = await this.catalogRepository.findEndpointByMethodAndPath(candidate.method, candidate.path);
      if (!endpoint) continue;
      await this.stressRepository.upsertStressProfile({
        endpointId: String(endpoint.id),
        code: `STRESS_${endpoint.code}`.slice(0, 180),
        name: candidate.name,
        targetRps: candidate.targetRps,
        durationSeconds: candidate.durationSeconds,
        concurrency: candidate.concurrency,
        environmentScope: ['LOCAL', 'STAGING'],
        maxErrorRate: 0.01,
        maxP95Ms: endpoint.riskLevel === 'CRITICAL' ? 1200 : 900,
        isEnabled: true,
        requiresApproval: true,
        status: 'ACTIVE',
        notes: 'Perfil inicial seguro. Ejecutar solo en local/staging hasta tener job runner aislado.',
        actorId: 'system_seed',
      });
      count += 1;
    }
    return count;
  }

  private listDatabaseTables(): Promise<IntrospectedTable[]> {
    return this.sequelize.query<IntrospectedTable>(
      `
SELECT table_schema AS "schemaName",
       table_name AS "tableName"
  FROM information_schema.tables
 WHERE table_schema NOT IN ('pg_catalog', 'information_schema')
   AND table_type = 'BASE TABLE'
 ORDER BY table_schema ASC, table_name ASC;
`,
      { type: QueryTypes.SELECT },
    );
  }

  private listDatabaseColumns(): Promise<IntrospectedColumn[]> {
    return this.sequelize.query<IntrospectedColumn>(
      `
WITH pk_columns AS (
  SELECT kcu.table_schema,
         kcu.table_name,
         kcu.column_name
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu
      ON kcu.constraint_schema = tc.constraint_schema
     AND kcu.constraint_name = tc.constraint_name
     AND kcu.table_schema = tc.table_schema
     AND kcu.table_name = tc.table_name
   WHERE tc.constraint_type = 'PRIMARY KEY'
),
fk_columns AS (
  SELECT kcu.table_schema,
         kcu.table_name,
         kcu.column_name,
         ccu.table_schema AS referenced_schema,
         ccu.table_name AS referenced_table,
         ccu.column_name AS referenced_column
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu
      ON kcu.constraint_schema = tc.constraint_schema
     AND kcu.constraint_name = tc.constraint_name
     AND kcu.table_schema = tc.table_schema
     AND kcu.table_name = tc.table_name
    JOIN information_schema.constraint_column_usage ccu
      ON ccu.constraint_schema = tc.constraint_schema
     AND ccu.constraint_name = tc.constraint_name
   WHERE tc.constraint_type = 'FOREIGN KEY'
)
SELECT c.table_schema AS "schemaName",
       c.table_name AS "tableName",
       c.column_name AS "columnName",
       c.ordinal_position::int AS "ordinalPosition",
       c.data_type AS "sqlDataType",
       (c.is_nullable = 'YES') AS "isNullable",
       c.column_default AS "columnDefault",
       (pk.column_name IS NOT NULL) AS "isPrimaryKey",
       (fk.column_name IS NOT NULL) AS "isForeignKey",
       fk.referenced_schema AS "referencedSchema",
       fk.referenced_table AS "referencedTable",
       fk.referenced_column AS "referencedColumn"
  FROM information_schema.columns c
  LEFT JOIN pk_columns pk
    ON pk.table_schema = c.table_schema
   AND pk.table_name = c.table_name
   AND pk.column_name = c.column_name
  LEFT JOIN fk_columns fk
    ON fk.table_schema = c.table_schema
   AND fk.table_name = c.table_name
   AND fk.column_name = c.column_name
 WHERE c.table_schema NOT IN ('pg_catalog', 'information_schema')
 ORDER BY c.table_schema ASC, c.table_name ASC, c.ordinal_position ASC;
`,
      { type: QueryTypes.SELECT },
    );
  }

  private async upsertCatalogColumn(column: IntrospectedColumn): Promise<void> {
    const [entity, referencedEntity] = await Promise.all([
      this.catalogRepository.findDataEntityByTable(column.schemaName, column.tableName),
      column.referencedSchema && column.referencedTable
        ? this.catalogRepository.findDataEntityByTable(column.referencedSchema, column.referencedTable)
        : Promise.resolve(null),
    ]);
    const signals = this.classifyColumn(column.columnName, column.tableName);
    const reviewStatus =
      signals.containsPii || signals.containsFinancialData || signals.containsSensitive ? 'NEEDS_REVIEW' : 'AUTO_DETECTED';
    const businessName = this.humanize(column.columnName);
    const systemPurpose = column.isPrimaryKey
      ? `Identifica de forma única registros de ${column.tableName} dentro de la base Atlas.`
      : column.isForeignKey && column.referencedTable
        ? `Relaciona ${column.tableName} con ${column.referencedTable} mediante integridad referencial.`
        : `Columna persistida en ${column.schemaName}.${column.tableName}, detectada desde information_schema para trazabilidad técnica.`;

    await this.sequelize.query(
      `
INSERT INTO system_data_field_catalog (
  data_entity_id, schema_name, table_name, column_name, ordinal_position, sql_data_type,
  is_nullable, column_default, is_primary_key, is_foreign_key, referenced_schema,
  referenced_table, referenced_column, references_entity_id, business_name, business_meaning, technical_meaning,
  system_purpose, business_purpose, why_store, who_uses, audit_usage, analysis_usage,
  decision_usage, source_kind, backend_write_behavior, data_nature, governance_category,
  sensitivity_level, contains_pii, pii_type, contains_sensitive, contains_financial_data,
  contains_risk_data, contains_fraud_signal, contains_capacity_signal, is_ml_candidate,
  used_in_scoring, used_in_ml, quality_rules_json, validation_rule_json, source_document,
  detected_from, confidence_level, review_status, status, _created_at, _updated_at
) VALUES (
  :dataEntityId, :schemaName, :tableName, :columnName, :ordinalPosition, :sqlDataType,
  :isNullable, :columnDefault, :isPrimaryKey, :isForeignKey, :referencedSchema,
  :referencedTable, :referencedColumn, :referencesEntityId, :businessName, :businessMeaning, :technicalMeaning,
  :systemPurpose, NULL, :whyStore, CAST(:whoUses AS jsonb), :auditUsage, :analysisUsage,
  :decisionUsage, 'DATABASE_READ', :backendWriteBehavior, 'OPERACIONAL', :governanceCategory,
  :sensitivityLevel, :containsPii, :piiType, :containsSensitive, :containsFinancialData,
  :containsRiskData, :containsFraudSignal, :containsCapacitySignal, :isMlCandidate,
  :usedInScoring, :usedInMl, '[]'::jsonb, CAST(:validationRule AS jsonb), 'information_schema',
  'information_schema_enriched', 'MEDIUM', :reviewStatus, 'ACTIVE', NOW(), NOW()
)
ON CONFLICT (schema_name, table_name, column_name)
DO UPDATE SET
  data_entity_id = EXCLUDED.data_entity_id,
  ordinal_position = EXCLUDED.ordinal_position,
  sql_data_type = EXCLUDED.sql_data_type,
  is_nullable = EXCLUDED.is_nullable,
  column_default = EXCLUDED.column_default,
  is_primary_key = EXCLUDED.is_primary_key,
  is_foreign_key = EXCLUDED.is_foreign_key,
  referenced_schema = EXCLUDED.referenced_schema,
  referenced_table = EXCLUDED.referenced_table,
  referenced_column = EXCLUDED.referenced_column,
  references_entity_id = EXCLUDED.references_entity_id,
  status = 'ACTIVE',
  detected_from = CASE
    WHEN system_data_field_catalog.manually_edited_at IS NULL THEN EXCLUDED.detected_from
    ELSE system_data_field_catalog.detected_from
  END,
  business_name = COALESCE(system_data_field_catalog.business_name, EXCLUDED.business_name),
  technical_meaning = CASE
    WHEN system_data_field_catalog.manually_edited_at IS NULL THEN COALESCE(system_data_field_catalog.technical_meaning, EXCLUDED.technical_meaning)
    ELSE system_data_field_catalog.technical_meaning
  END,
  system_purpose = CASE
    WHEN system_data_field_catalog.manually_edited_at IS NULL THEN COALESCE(system_data_field_catalog.system_purpose, EXCLUDED.system_purpose)
    ELSE system_data_field_catalog.system_purpose
  END,
  business_meaning = COALESCE(system_data_field_catalog.business_meaning, EXCLUDED.business_meaning),
  business_purpose = system_data_field_catalog.business_purpose,
  contains_pii = CASE
    WHEN system_data_field_catalog.manually_edited_at IS NULL THEN EXCLUDED.contains_pii
    ELSE system_data_field_catalog.contains_pii
  END,
  pii_type = CASE
    WHEN system_data_field_catalog.manually_edited_at IS NULL THEN EXCLUDED.pii_type
    ELSE system_data_field_catalog.pii_type
  END,
  contains_sensitive = CASE
    WHEN system_data_field_catalog.manually_edited_at IS NULL THEN EXCLUDED.contains_sensitive
    ELSE system_data_field_catalog.contains_sensitive
  END,
  contains_financial_data = CASE
    WHEN system_data_field_catalog.manually_edited_at IS NULL THEN EXCLUDED.contains_financial_data
    ELSE system_data_field_catalog.contains_financial_data
  END,
  contains_risk_data = CASE
    WHEN system_data_field_catalog.manually_edited_at IS NULL THEN EXCLUDED.contains_risk_data
    ELSE system_data_field_catalog.contains_risk_data
  END,
  contains_fraud_signal = CASE
    WHEN system_data_field_catalog.manually_edited_at IS NULL THEN EXCLUDED.contains_fraud_signal
    ELSE system_data_field_catalog.contains_fraud_signal
  END,
  is_ml_candidate = CASE
    WHEN system_data_field_catalog.manually_edited_at IS NULL THEN EXCLUDED.is_ml_candidate
    ELSE system_data_field_catalog.is_ml_candidate
  END,
  used_in_scoring = CASE
    WHEN system_data_field_catalog.manually_edited_at IS NULL THEN EXCLUDED.used_in_scoring
    ELSE system_data_field_catalog.used_in_scoring
  END,
  used_in_ml = CASE
    WHEN system_data_field_catalog.manually_edited_at IS NULL THEN EXCLUDED.used_in_ml
    ELSE system_data_field_catalog.used_in_ml
  END,
  review_status = CASE
    WHEN system_data_field_catalog.review_status = 'AUTO_DETECTED' AND EXCLUDED.review_status = 'NEEDS_REVIEW' THEN 'NEEDS_REVIEW'
    ELSE system_data_field_catalog.review_status
  END,
  confidence_level = CASE
    WHEN system_data_field_catalog.confidence_level = 'LOW' THEN 'MEDIUM'
    ELSE system_data_field_catalog.confidence_level
  END,
  _updated_at = NOW();
`,
      {
        replacements: {
          dataEntityId: entity ? String(entity.id) : null,
          schemaName: column.schemaName,
          tableName: column.tableName,
          columnName: column.columnName,
          ordinalPosition: column.ordinalPosition,
          sqlDataType: column.sqlDataType,
          isNullable: column.isNullable,
          columnDefault: column.columnDefault,
          isPrimaryKey: column.isPrimaryKey,
          isForeignKey: column.isForeignKey,
          referencedSchema: column.referencedSchema,
          referencedTable: column.referencedTable,
          referencedColumn: column.referencedColumn,
          referencesEntityId: referencedEntity ? String(referencedEntity.id) : null,
          businessName,
          businessMeaning: `Campo ${businessName} de ${column.tableName}; pendiente de validación de negocio por data owner.`,
          technicalMeaning: systemPurpose,
          systemPurpose,
          whyStore: `Se conserva como parte del registro ${column.tableName} para operación, auditoría y análisis.`,
          whoUses: JSON.stringify(['systems', 'data-governance']),
          auditUsage:
            column.isPrimaryKey || column.isForeignKey
              ? 'Clave usada para trazabilidad, joins y reconstrucción de eventos.'
              : 'Campo disponible para auditoría según endpoints que lean o escriban la tabla.',
          analysisUsage: 'Puede alimentar diagnósticos, reportes internos o controles de calidad si el dominio lo requiere.',
          decisionUsage: signals.containsRiskData
            ? 'Puede participar en decisiones de riesgo, fraude o calidad y requiere revisión humana.'
            : 'Uso de decisión pendiente de curaduría por negocio.',
          backendWriteBehavior: column.columnDefault
            ? 'Puede ser completada por default de base de datos o por backend.'
            : 'Persistida por backend, migración o proceso interno según el flujo.',
          governanceCategory: signals.containsSensitive ? 'SENSITIVE' : 'OPERACIONAL',
          sensitivityLevel: signals.containsSensitive ? 'CONFIDENTIAL' : 'INTERNAL',
          containsPii: signals.containsPii,
          piiType: signals.piiType,
          containsSensitive: signals.containsSensitive,
          containsFinancialData: signals.containsFinancialData,
          containsRiskData: signals.containsRiskData,
          containsFraudSignal: signals.containsFraudSignal,
          containsCapacitySignal: signals.containsCapacitySignal,
          isMlCandidate: signals.isMlCandidate,
          usedInScoring: signals.usedInScoring,
          usedInMl: signals.usedInMl,
          validationRule: JSON.stringify({ nullable: column.isNullable, dataType: column.sqlDataType }),
          reviewStatus,
        },
      },
    );
  }

  private async upsertCatalogRelationship(column: IntrospectedColumn): Promise<void> {
    const [source, target] = await Promise.all([
      this.catalogRepository.findDataEntityByTable(column.schemaName, column.tableName),
      this.catalogRepository.findDataEntityByTable(column.referencedSchema ?? column.schemaName, column.referencedTable ?? ''),
    ]);
    const existing = await this.sequelize.query<{ id: string }>(
      `
SELECT _id::text AS id
  FROM system_data_relationship_catalog
 WHERE source_schema = :sourceSchema
   AND source_table = :sourceTable
   AND COALESCE(source_column, '') = COALESCE(:sourceColumn, '')
   AND target_schema = :targetSchema
   AND target_table = :targetTable
   AND COALESCE(target_column, '') = COALESCE(:targetColumn, '')
   AND relationship_type = 'FOREIGN_KEY'
 LIMIT 1;
`,
      {
        replacements: {
          sourceSchema: column.schemaName,
          sourceTable: column.tableName,
          sourceColumn: column.columnName,
          targetSchema: column.referencedSchema,
          targetTable: column.referencedTable,
          targetColumn: column.referencedColumn,
        },
        type: QueryTypes.SELECT,
      },
    );

    const replacements = {
      sourceDataEntityId: source ? String(source.id) : null,
      targetDataEntityId: target ? String(target.id) : null,
      sourceSchema: column.schemaName,
      sourceTable: column.tableName,
      sourceColumn: column.columnName,
      targetSchema: column.referencedSchema,
      targetTable: column.referencedTable,
      targetColumn: column.referencedColumn,
      businessReason: `${column.tableName}.${column.columnName} referencia ${column.referencedTable}.${column.referencedColumn} para mantener consistencia entre entidades de negocio.`,
      technicalReason: `Foreign key detectada desde information_schema entre ${column.schemaName}.${column.tableName}.${column.columnName} y ${column.referencedSchema}.${column.referencedTable}.${column.referencedColumn}.`,
    };

    if (existing[0]) {
      await this.sequelize.query(
        `
UPDATE system_data_relationship_catalog
   SET source_data_entity_id = :sourceDataEntityId,
       target_data_entity_id = :targetDataEntityId,
       business_reason = COALESCE(business_reason, :businessReason),
       technical_reason = COALESCE(technical_reason, :technicalReason),
       confidence_level = CASE WHEN confidence_level = 'LOW' THEN 'MEDIUM' ELSE confidence_level END,
       _updated_at = NOW()
 WHERE _id::text = :id;
`,
        { replacements: { ...replacements, id: existing[0].id } },
      );
      return;
    }

    await this.sequelize.query(
      `
INSERT INTO system_data_relationship_catalog (
  source_data_entity_id, target_data_entity_id, source_schema, source_table, source_column,
  target_schema, target_table, target_column, relationship_type, cardinality, optionality,
  business_reason, technical_reason, audit_usage, analysis_usage, decision_usage,
  enforcement_strategy, delete_policy, source_document, confidence_level, review_status,
  _created_at, _updated_at
) VALUES (
  :sourceDataEntityId, :targetDataEntityId, :sourceSchema, :sourceTable, :sourceColumn,
  :targetSchema, :targetTable, :targetColumn, 'FOREIGN_KEY', 'N:1', 'REQUIRED_WHEN_PRESENT',
  :businessReason, :technicalReason, 'Permite reconstruir dependencias entre registros.',
  'Permite navegar linaje y joins confiables para reportes.', 'Ayuda a entender impacto de cambios entre tablas relacionadas.',
  'FOREIGN_KEY_OR_LOGICAL_VALIDATION', 'RESTRICT_OR_SOFT_DELETE', 'information_schema_fk',
  'MEDIUM', 'AUTO_DETECTED', NOW(), NOW()
);
`,
      { replacements },
    );
  }

  private async markMissingColumnsAsDeprecated(activeKeys: Set<string>): Promise<void> {
    if (activeKeys.size === 0) return;
    await this.sequelize.query(
      `
UPDATE system_data_field_catalog
   SET status = 'DEPRECATED_CANDIDATE',
       _updated_at = NOW()
 WHERE detected_from = 'information_schema_enriched'
   AND status = 'ACTIVE'
   AND (schema_name || '.' || table_name || '.' || column_name) NOT IN (:activeKeys);
`,
      { replacements: { activeKeys: [...activeKeys] } },
    );
  }

  private classifyColumn(columnName: string, tableName: string) {
    const normalized = `${tableName}.${columnName}`.toLowerCase();
    const piiType = /email/.test(normalized)
      ? 'EMAIL'
      : /phone|mobile|whatsapp/.test(normalized)
        ? 'PHONE'
        : /dni|document|identity|passport|nit/.test(normalized)
          ? 'IDENTITY_DOCUMENT'
          : /address|gps|lat|lon|location/.test(normalized)
            ? 'LOCATION'
            : /token|password|secret|credential/.test(normalized)
              ? 'CREDENTIAL'
              : null;
    const containsPii = Boolean(piiType) || /customer|user|name|birth/.test(normalized);
    const containsFinancialData = /amount|balance|income|salary|payment|loan|debt|credit|currency|limit/.test(normalized);
    const containsRiskData = /risk|score|rating|policy|rule|decision|quality/.test(normalized);
    const containsFraudSignal = /fraud|watchlist|reputation|fingerprint/.test(normalized);
    const containsCapacitySignal = /capacity|quota|limit|usage/.test(normalized);
    const usedInScoring = /score|risk|feature|model|assessment/.test(normalized);
    const usedInMl = /feature|model|prediction|embedding|ml_/.test(normalized);
    return {
      containsPii,
      piiType,
      containsFinancialData,
      containsRiskData,
      containsFraudSignal,
      containsCapacitySignal,
      containsSensitive: containsPii || containsFinancialData || containsRiskData || containsFraudSignal,
      isMlCandidate: usedInMl || usedInScoring,
      usedInScoring,
      usedInMl,
    };
  }

  private humanize(value: string): string {
    return value
      .split('_')
      .filter(Boolean)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(' ');
  }

  private async upsertImpactForTable(
    endpointId: string,
    tableName: string,
    operationType: string,
    isPrimaryEntity: boolean,
  ): Promise<boolean> {
    const entity = await this.catalogRepository.findDataEntityByTable('public', tableName);
    if (!entity) return false;
    await this.catalogRepository.upsertDataImpact({
      endpointId,
      dataEntityId: String(entity.id),
      operationType,
      impactLevel: entity.isAuditCritical ? 'HIGH' : 'MEDIUM',
      isPrimaryEntity,
      affectsCustomerState: entity.module === 'customers',
      affectsRiskState: entity.containsRiskData,
      affectsLegalState: entity.containsLegalData,
      affectsDeviceState: entity.containsDeviceData,
      affectsNotificationState: entity.module === 'notifications',
      requiresStressTest: entity.isAuditCritical,
      detectedFrom: 'docs/endpoints/endpoints.md',
      confidenceLevel: 'HIGH',
      reviewStatus: 'AUTO_DETECTED',
    });
    return true;
  }

  private parseEndpointDocs(): DocsImpact[] {
    const path = join(process.cwd(), 'docs', 'endpoints', 'endpoints.md');
    if (!existsSync(path)) return [];
    const lines = readFileSync(path, 'utf8').split('\n');
    const impacts: DocsImpact[] = [];
    let current: DocsImpact | null = null;
    let section: 'reads' | 'writes' | null = null;

    for (const line of lines) {
      const endpoint = line.match(/^(GET|POST|PATCH|PUT|DELETE)\s+(`)?(\/api\/v[0-9]+\/[^`\s]+)\2?/);
      const httpBlock = line.match(/^```http\s*$/);
      if (httpBlock) continue;
      const inlineHttp = line.match(/^(GET|POST|PATCH|PUT|DELETE)\s+(\/api\/v[0-9]+\/\S+)/);
      const detected = endpoint ?? inlineHttp;
      if (detected) {
        if (current) impacts.push(current);
        current = { method: detected[1], path: detected[3] ?? detected[2], reads: [], writes: [] };
        section = null;
        continue;
      }
      if (!current) continue;
      if (/^###\s+Lee/.test(line)) {
        section = 'reads';
        continue;
      }
      if (/^###\s+Escribe/.test(line)) {
        section = 'writes';
        continue;
      }
      if (/^###\s+/.test(line) || /^---/.test(line)) {
        section = null;
        continue;
      }
      const table = line.match(/^\s*-\s+`([^`]+)`/);
      if (table && section) current[section].push(table[1]);
    }
    if (current) impacts.push(current);
    return impacts.filter((impact) => impact.reads.length > 0 || impact.writes.length > 0);
  }
}
