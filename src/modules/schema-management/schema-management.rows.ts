/**
 * @file Tipos de fila y entradas del catálogo de esquema.
 * @business Esta pieza gobierna propuestas de estructura sin permitir DDL directo desde el portal.
 * @system valida y audita el catálogo de cambios; la ejecución física permanece en migraciones revisadas.
 */

export interface SchemaVersionRow {
  _id: string;
  version_code: string;
  created_by_platform_user_id: string | null;
  created_at: Date;
  notes: string | null;
  is_active: boolean;
  parent_version_id: string | null;
}

export interface SchemaTableRow {
  _id: string;
  schema_version_id: string;
  table_name: string;
  table_type: 'transactional' | 'catalog' | 'audit' | 'operational';
  is_append_only: boolean;
  is_tenant_scoped: boolean;
  description: string | null;
  created_at: Date;
  is_deleted: boolean;
}

export interface SchemaColumnRow {
  _id: string;
  schema_table_id: string;
  column_name: string;
  column_type: string;
  is_nullable: boolean;
  is_immutable: boolean;
  is_pii: boolean;
  is_indexed: boolean;
  default_value: string | null;
  description: string | null;
  is_deleted: boolean;
}

export interface SchemaRelationshipRow {
  _id: string;
  schema_version_id: string;
  source_table_id: string;
  source_column_name: string;
  target_table_id: string;
  target_table_name: string | null;
  target_column_name: string;
  cascade_delete: boolean;
  is_immutable: boolean;
}

export type SchemaChangeApprovalStatus = 'pending' | 'approved' | 'rejected';
export type SchemaChangeResult = 'pending' | 'success' | 'failed' | 'rejected';

export interface SchemaChangeLogRow {
  _id: string;
  schema_version_id: string | null;
  change_type: string;
  affected_entity_id: string | null;
  affected_entity_type: string;
  change_payload: Record<string, unknown>;
  /** Proponente de plataforma o interno: la base exige al menos uno (`ck_schema_change_log_requester_present`). */
  requester_platform_user_id: string | null;
  requester_internal_user_id: string | null;
  approval_status: SchemaChangeApprovalStatus;
  approved_by_platform_user_id: string | null;
  approved_by_internal_user_id: string | null;
  approved_at: Date | null;
  approval_notes: string | null;
  rolled_back: boolean;
  change_result: SchemaChangeResult | null;
  error_message: string | null;
  /** Migración que materializó el cambio aprobado (`linkSchemaChangeToMigration`). */
  applied_by_migration: string | null;
  applied_at: Date | null;
  created_at: Date;
}

export interface SchemaVersionCounts {
  tablesCount: number;
  columnsCount: number;
  relationshipsCount: number;
}

export interface SchemaNameSummaryRow {
  schema_name: string;
  tables_count: string;
  columns_count: string;
}

export interface SchemaTableCounts {
  columnsCount: number;
  relationshipsCount: number;
}

export interface CreateChangeLogEntryInput {
  changeType: string;
  affectedEntityType: string;
  changePayload: Record<string, unknown>;
  /** Exactamente uno de los dos: el del actor que propone. */
  requesterPlatformUserId: string | null;
  requesterInternalUserId: string | null;
}

export interface ResolveChangeLogEntryInput {
  approvalStatus: Extract<SchemaChangeApprovalStatus, 'approved' | 'rejected'>;
  approvedByPlatformUserId: string | null;
  approvedByInternalUserId: string | null;
  approvalNotes: string | null;
  changeResult: SchemaChangeResult;
  errorMessage: string | null;
}
