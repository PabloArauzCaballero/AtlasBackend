/**
 * @file Servicio de aplicación o dominio: ejecuta reglas y coordina dependencias.
 * @business Esta pieza hace observable y gobernable el propio backend para operaciones, QA y arquitectura.
 * @system introspecciona el esquema real de PostgreSQL y refleja columnas y relaciones en el catálogo.
 */
import { Injectable } from '@nestjs/common';
import { InjectConnection } from '@nestjs/sequelize';
import { QueryTypes } from 'sequelize';
import { Sequelize } from 'sequelize-typescript';
import { mapWithConcurrency } from '../../common/utils/concurrency.util.js';
import { ATLAS_SCHEMAS } from '../../database/domain-schemas.js';
import {
  DEPRECATE_MISSING_FIELDS_SQL,
  INSERT_RELATIONSHIP_CATALOG_SQL,
  UPDATE_RELATIONSHIP_CATALOG_SQL,
  UPSERT_FIELD_CATALOG_SQL,
} from './systems-catalog-sql.constants.js';
import { classifyColumn, humanizeIdentifier } from './column-classification.util.js';
import { SystemsCatalogClassifierService } from './systems-catalog-classifier.service.js';
import { SystemsCatalogRepository } from './systems-catalog.repository.js';

/** Cuántas filas se procesan en paralelo por lote al reflejar el esquema. */
const SEED_CONCURRENCY = 20;

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

/**
 * El catálogo, reflejado desde la BASE y no desde el código.
 *
 * Salió de `SystemsCatalogSeedService` porque es la mitad más pesada y la única que habla con
 * `information_schema`: cientos de tablas y miles de columnas, con su propia política de
 * concurrencia y su propia noción de qué hacer con lo que ya no existe. Mezclada con las semillas
 * curadas, el archivo pasaba de 690 líneas y no se podía leer una sin la otra.
 */
@Injectable()
export class SystemsSchemaIntrospectionService {
  constructor(
    @InjectConnection() private readonly sequelize: Sequelize,
    private readonly catalogRepository: SystemsCatalogRepository,
    private readonly classifier: SystemsCatalogClassifierService,
  ) {}

  async seedColumnsFromInformationSchema(): Promise<{ columns: number; relationships: number }> {
    // `tables`/`columns` vienen de introspección de `information_schema` sobre TODO el esquema
    // (cientos de tablas, potencialmente miles de columnas) — un `await` secuencial por fila
    // serializaría esa cantidad de round trips contra la BD. `mapWithConcurrency` los dispara en
    // lotes acotados en vez de uno a la vez o todos de golpe.
    const tables = await this.listDatabaseTables();
    await mapWithConcurrency(tables, SEED_CONCURRENCY, async (table) => {
      const existing = await this.catalogRepository.findDataEntityByTable(table.schemaName, table.tableName);
      if (!existing) {
        await this.catalogRepository.upsertDataEntity({
          ...this.classifier.classifyTable(table.tableName, null),
          schemaName: table.schemaName,
          detectedFrom: 'information_schema_enriched',
          confidenceLevel: 'MEDIUM',
        });
      }
    });

    const columns = await this.listDatabaseColumns();
    const activeKeys = new Set<string>();
    let relationshipCount = 0;
    await mapWithConcurrency(columns, SEED_CONCURRENCY, async (column) => {
      activeKeys.add(`${column.schemaName}.${column.tableName}.${column.columnName}`);
      await this.upsertCatalogColumn(column);
      if (column.isForeignKey && column.referencedTable && column.referencedColumn) {
        await this.upsertCatalogRelationship(column);
        relationshipCount += 1;
      }
    });
    await this.markMissingColumnsAsDeprecated(activeKeys);
    return { columns: columns.length, relationships: relationshipCount };
  }

  listDatabaseTables(): Promise<IntrospectedTable[]> {
    return this.sequelize.query<IntrospectedTable>(
      `
SELECT table_schema AS "schemaName",
       table_name AS "tableName"
  FROM information_schema.tables
 WHERE table_schema IN (:schemas)
   AND table_type = 'BASE TABLE'
 ORDER BY table_schema ASC, table_name ASC;
`,
      { replacements: { schemas: Object.values(ATLAS_SCHEMAS) }, type: QueryTypes.SELECT },
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
  WHERE c.table_schema IN (:schemas)
 ORDER BY c.table_schema ASC, c.table_name ASC, c.ordinal_position ASC;
`,
      { replacements: { schemas: Object.values(ATLAS_SCHEMAS) }, type: QueryTypes.SELECT },
    );
  }

  private async upsertCatalogColumn(column: IntrospectedColumn): Promise<void> {
    const [entity, referencedEntity] = await Promise.all([
      this.catalogRepository.findDataEntityByTable(column.schemaName, column.tableName),
      column.referencedSchema && column.referencedTable
        ? this.catalogRepository.findDataEntityByTable(column.referencedSchema, column.referencedTable)
        : Promise.resolve(null),
    ]);
    const signals = classifyColumn(column.columnName, column.tableName);
    const reviewStatus =
      signals.containsPii || signals.containsFinancialData || signals.containsSensitive ? 'NEEDS_REVIEW' : 'AUTO_DETECTED';
    const businessName = humanizeIdentifier(column.columnName);
    const systemPurpose = column.isPrimaryKey
      ? `Identifica de forma única registros de ${column.tableName} dentro de la base Atlas.`
      : column.isForeignKey && column.referencedTable
        ? `Relaciona ${column.tableName} con ${column.referencedTable} mediante integridad referencial.`
        : `Columna persistida en ${column.schemaName}.${column.tableName}, detectada desde information_schema para trazabilidad técnica.`;

    await this.sequelize.query(UPSERT_FIELD_CATALOG_SQL, {
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
    });
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
      await this.sequelize.query(UPDATE_RELATIONSHIP_CATALOG_SQL, {
        replacements: { ...replacements, id: existing[0].id },
      });
      return;
    }

    await this.sequelize.query(INSERT_RELATIONSHIP_CATALOG_SQL, { replacements });
  }

  private async markMissingColumnsAsDeprecated(activeKeys: Set<string>): Promise<void> {
    if (activeKeys.size === 0) return;
    await this.sequelize.query(DEPRECATE_MISSING_FIELDS_SQL, { replacements: { activeKeys: [...activeKeys] } });
  }
}
