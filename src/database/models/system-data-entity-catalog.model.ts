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

@Table({
  tableName: 'system_data_entity_catalog',
  schema: atlasSchemaFor('system_data_entity_catalog'),
  timestamps: false,
  defaultScope: { attributes: { exclude: NARRATIVE_ATTRIBUTES } },
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
