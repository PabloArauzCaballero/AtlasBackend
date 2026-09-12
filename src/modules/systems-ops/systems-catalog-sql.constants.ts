/**
 * @file Utilidad pura o acotada reutilizable dentro de su capa.
 * @business Esta pieza hace observable y gobernable el propio backend para operaciones, QA y arquitectura.
 * @system declara las sentencias con las que el catálogo refleja el esquema real de la base.
 */

/**
 * SQL del reflejo del esquema, fuera del servicio que lo ejecuta.
 *
 * Son sentencias largas y declarativas —una fila del catálogo tiene 47 columnas— y mezcladas con la
 * lógica hacían ilegible el único archivo que decide QUÉ se refleja y con qué concurrencia.
 */
export const UPSERT_FIELD_CATALOG_SQL = `
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
`;

export const UPDATE_RELATIONSHIP_CATALOG_SQL = `
UPDATE system_data_relationship_catalog
   SET source_data_entity_id = :sourceDataEntityId,
       target_data_entity_id = :targetDataEntityId,
       business_reason = COALESCE(business_reason, :businessReason),
       technical_reason = COALESCE(technical_reason, :technicalReason),
       confidence_level = CASE WHEN confidence_level = 'LOW' THEN 'MEDIUM' ELSE confidence_level END,
       _updated_at = NOW()
 WHERE _id::text = :id;
`;

export const INSERT_RELATIONSHIP_CATALOG_SQL = `
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
`;

export const DEPRECATE_MISSING_FIELDS_SQL = `
UPDATE system_data_field_catalog
   SET status = 'DEPRECATED_CANDIDATE',
       _updated_at = NOW()
 WHERE detected_from = 'information_schema_enriched'
   AND status = 'ACTIVE'
   AND (schema_name || '.' || table_name || '.' || column_name) NOT IN (:activeKeys);
`;
