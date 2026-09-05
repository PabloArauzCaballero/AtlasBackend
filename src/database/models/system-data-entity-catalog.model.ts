/**
 * @file Modelo ORM: mapea una tabla y su contrato tipado.
 * @business Esta pieza preserva la fuente de verdad y la evidencia histórica que soportan decisiones y cumplimiento.
 * @system define models para evolucionar, mapear, sembrar o consultar PostgreSQL de forma controlada.
 */
import { Column, DataType, Model, Table } from 'sequelize-typescript';
import { atlasSchemaFor } from '../domain-schemas.js';

/**
 * Columnas de narrativa: cinco textos largos (~6 KB por fila) que solo tienen sentido en el detalle
 * de una entidad. Se excluyen por defecto para que el listado de 130 entidades no traiga ~800 KB de
 * texto que el mapper descarta; el detalle los pide con `.unscoped()`.
 */
const NARRATIVE_ATTRIBUTES = [
  // Nombres de ATRIBUTO, no de columna: `attributes.exclude` de Sequelize trabaja sobre las claves
  // del modelo. Poner aquí `business_why_exists` no excluiría nada y el filtro sería un no-op.
  'businessWhyExists',
  'businessWhyNotDelete',
  'businessDecisionContribution',
  'businessUsageExample',
  'systemsExplanation',
];

/**
 * El índice único de `(schema_name, table_name)` se DECLARA aquí, y no sólo en la migración.
 *
 * Sin declararlo, `upsert()` no sabe sobre qué conflicto escribir su `ON CONFLICT` y cae a un
 * INSERT que la base rechaza en cuanto la fila ya existe. El efecto medido: el refresco del
 * catálogo —el que alimenta la metadata del portal— fallaba con «Validation error» en la PRIMERA
 * tabla ya catalogada, así que sólo entraban las nuevas hasta la primera repetida y la metadata
 * quedaba congelada sin que nada lo dijera. El trabajo terminaba en `failed` y la pantalla seguía
 * mostrando lo de siempre.
 */
@Table({
  tableName: 'system_data_entity_catalog',
  schema: atlasSchemaFor('system_data_entity_catalog'),
  timestamps: false,
  defaultScope: { attributes: { exclude: NARRATIVE_ATTRIBUTES } },
  /*
   * El unico declarado tiene que ser el que EXISTE en la base.
   *
   * Estaba como `(schema_name, table_name)` y la base lo tiene como
   * `(system_code, schema_name, table_name)` desde que el catalogo pasó a federar varios sistemas.
   * Sequelize deduce de aqui el `ON CONFLICT` de su `upsert`, asi que la discrepancia hacia estallar
   * el refresco entero con «there is no unique or exclusion constraint matching the ON CONFLICT
   * specification» — y con el, el descubrimiento de endpoints, que corre despues.
   */
  indexes: [
    { name: 'ux_system_data_entity_catalog_block_schema_table', unique: true, fields: ['system_code', 'schema_name', 'table_name'] },
  ],
})
export class SystemDataEntityCatalogModel extends Model {
  @Column({ field: '_id', type: DataType.BIGINT, primaryKey: true, autoIncrement: true, allowNull: false })
  declare id: string;

  /**
   * Bloque del ecosistema al que pertenece la tabla: `ATLAS_BACKEND`, `DECISION_ENGINE`, `ERP_BACKEND`.
   *
   * Sin esta columna el catálogo sólo podía contener tablas de este backend, porque no había forma
   * de decir de quién era cada fila. Forma parte de la clave única junto con esquema y tabla: el
   * motor guarda todo en `public` y el ERP tiene su propio `atlas_accounting`, así que dos bloques
   * pueden llamar igual a dos tablas que no tienen nada que ver.
   */
  @Column({ field: 'system_code', type: DataType.STRING(60), allowNull: false, defaultValue: 'ATLAS_BACKEND' })
  declare systemCode: string;

  @Column({ field: 'schema_name', type: DataType.STRING(120), allowNull: false })
  declare schemaName: string;

  @Column({ field: 'table_name', type: DataType.STRING(180), allowNull: false })
  declare tableName: string;

  @Column({ field: 'model_name', type: DataType.STRING(180) })
  declare modelName: string | null;

  @Column({ field: 'entity_name', type: DataType.STRING(220), allowNull: false })
  declare entityName: string;

  @Column({ type: DataType.STRING(120), allowNull: false })
  declare module: string;

  @Column({ field: 'business_purpose', type: DataType.TEXT, allowNull: false })
  declare businessPurpose: string;

  /*
   * Metadata que el catálogo CALCULA al sembrar y que este modelo no declaraba.
   *
   * Diecisiete columnas existían en la base, el repositorio las pasaba en cada `upsert` y Sequelize
   * las descartaba en silencio por no estar declaradas aquí — así que el portal mostraba entidades
   * sin propósito técnico, sin proceso de negocio, sin quién las usa y sin de qué sistema vienen.
   * Nada fallaba: simplemente se guardaba menos de lo que se computaba, y el hueco sólo se veía
   * mirando la tabla.
   */
  @Column({ type: DataType.TEXT })
  declare description: string | null;

  @Column({ field: 'technical_purpose', type: DataType.TEXT })
  declare technicalPurpose: string | null;

  @Column({ field: 'business_process', type: DataType.TEXT })
  declare businessProcess: string | null;

  @Column({ field: 'why_store', type: DataType.TEXT })
  declare whyStore: string | null;

  @Column({ field: 'who_uses', type: DataType.JSONB, allowNull: false })
  declare whoUses: unknown;

  @Column({ field: 'audit_usage', type: DataType.TEXT })
  declare auditUsage: string | null;

  @Column({ field: 'analysis_usage', type: DataType.TEXT })
  declare analysisUsage: string | null;

  @Column({ field: 'decision_usage', type: DataType.TEXT })
  declare decisionUsage: string | null;

  @Column({ field: 'data_nature', type: DataType.STRING(60), allowNull: false })
  declare dataNature: string;

  @Column({ field: 'domain_code', type: DataType.STRING(80) })
  declare domainCode: string | null;

  /** Qué representa UNA fila. Es lo que evita leer un conteo como si fuera otra cosa. */
  @Column({ field: 'data_grain', type: DataType.TEXT })
  declare dataGrain: string | null;

  /**
   * De qué sistema viene la entidad. Sin esto, las 95 tablas del ERP y las propias se mostraban
   * como si fueran una sola base, y no había forma de saber cuál se gobierna desde aquí.
   *
   * Se escribe con GUION —`atlas-backend`, `atlas-erp`—, igual que el nombre del servicio en
   * trazas y métricas. Convivieron las dos grafías: el seeder de narrativas ponía `atlas-backend`
   * y el repositorio `atlas_backend`, y dos nombres para el mismo sistema hacen que un filtro por
   * origen pierda filas sin avisar.
   */
  @Column({ field: 'source_system', type: DataType.STRING(80) })
  declare sourceSystem: string | null;

  @Column({ field: 'operational_rules_json', type: DataType.JSONB, allowNull: false })
  declare operationalRulesJson: unknown;

  @Column({ field: 'quality_rules_json', type: DataType.JSONB, allowNull: false })
  declare qualityRulesJson: unknown;

  @Column({ field: 'key_relationships_summary', type: DataType.TEXT })
  declare keyRelationshipsSummary: string | null;

  @Column({ field: 'relationship_rationale', type: DataType.TEXT })
  declare relationshipRationale: string | null;

  @Column({ field: 'internationalization_notes', type: DataType.TEXT })
  declare internationalizationNotes: string | null;

  // Narrativa de gobierno curada a mano (seeder `*-seed-data-entity-business-narrative.ts`).
  // Responde por qué existe la tabla, por qué no se borra, qué decide, un ejemplo y cómo funciona.
  @Column({ field: 'business_why_exists', type: DataType.TEXT })
  declare businessWhyExists: string | null;

  @Column({ field: 'business_why_not_delete', type: DataType.TEXT })
  declare businessWhyNotDelete: string | null;

  @Column({ field: 'business_decision_contribution', type: DataType.TEXT })
  declare businessDecisionContribution: string | null;

  @Column({ field: 'business_usage_example', type: DataType.TEXT })
  declare businessUsageExample: string | null;

  @Column({ field: 'systems_explanation', type: DataType.TEXT })
  declare systemsExplanation: string | null;

  /** `CURATED` (revisada por una persona) o `DOMAIN_TEMPLATE` (derivada del dominio). */
  @Column({ field: 'narrative_source', type: DataType.STRING(40) })
  declare narrativeSource: string | null;

  @Column({ field: 'narrative_updated_at', type: DataType.DATE })
  declare narrativeUpdatedAt: Date | null;

  @Column({ field: 'data_owner', type: DataType.STRING(120), allowNull: false })
  declare dataOwner: string;

  @Column({ field: 'contains_pii', type: DataType.BOOLEAN, allowNull: false })
  declare containsPii: boolean;

  @Column({ field: 'contains_financial_data', type: DataType.BOOLEAN, allowNull: false })
  declare containsFinancialData: boolean;

  @Column({ field: 'contains_risk_data', type: DataType.BOOLEAN, allowNull: false })
  declare containsRiskData: boolean;

  @Column({ field: 'contains_legal_data', type: DataType.BOOLEAN, allowNull: false })
  declare containsLegalData: boolean;

  @Column({ field: 'contains_device_data', type: DataType.BOOLEAN, allowNull: false })
  declare containsDeviceData: boolean;

  @Column({ field: 'contains_location_data', type: DataType.BOOLEAN, allowNull: false })
  declare containsLocationData: boolean;

  @Column({ field: 'is_audit_critical', type: DataType.BOOLEAN, allowNull: false })
  declare isAuditCritical: boolean;

  @Column({ field: 'retention_policy_code', type: DataType.STRING(120) })
  declare retentionPolicyCode: string | null;

  @Column({ type: DataType.STRING(40), allowNull: false })
  declare status: string;

  @Column({ field: 'detected_from', type: DataType.STRING(80), allowNull: false })
  declare detectedFrom: string;

  @Column({ field: 'confidence_level', type: DataType.STRING(20), allowNull: false })
  declare confidenceLevel: string;

  @Column({ field: 'review_status', type: DataType.STRING(40), allowNull: false })
  declare reviewStatus: string;

  @Column({ field: '_created_at', type: DataType.DATE, allowNull: false })
  declare createdAtValue: Date;

  @Column({ field: '_updated_at', type: DataType.DATE, allowNull: false })
  declare updatedAtValue: Date;
}
