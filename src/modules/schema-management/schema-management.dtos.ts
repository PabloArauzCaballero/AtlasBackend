/**
 * DTOs de schema-management: contratos públicos de la API.
 *
 * Nota: los IDs se exponen como string (los BIGINT de Postgres llegan como string
 * desde node-postgres y así se evita pérdida de precisión por Number en IDs grandes).
 */

export class SchemaVersionDto {
  _id!: string;
  versionCode!: string;
  createdAt!: Date;
  createdByPlatformUserId!: string | null;
  notes!: string | null;
  isActive!: boolean;
  parentVersionId!: string | null;
  tablesCount!: number;
  columnsCount!: number;
  relationshipsCount!: number;
}

export class SchemaColumnDto {
  _id!: string;
  columnName!: string;
  columnType!: string;
  isNullable!: boolean;
  isImmutable!: boolean;
  isPii!: boolean;
  isIndexed!: boolean;
  description!: string | null;
}

export class SchemaRelationshipDto {
  _id!: string;
  sourceColumnName!: string;
  targetTableName!: string;
  targetColumnName!: string;
  cascadeDelete!: boolean;
  isImmutable!: boolean;
}

export class SchemaTableDto {
  _id!: string;
  schemaVersionId!: string;
  tableName!: string;
  tableType!: 'transactional' | 'catalog' | 'audit' | 'operational';
  isAppendOnly!: boolean;
  isTenantScoped!: boolean;
  description!: string | null;
  columnsCount!: number;
  relationshipsCount!: number;
  createdAt!: Date;
  columns?: SchemaColumnDto[];
  relationships?: SchemaRelationshipDto[];
}

export class SchemaChangeLogDto {
  _id!: string;
  changeId!: string;
  schemaVersionId!: string | null;
  changeType!: string;
  affectedEntityType!: string;
  affectedEntityId!: string | null;
  changePayload!: Record<string, unknown>;
  approvalStatus!: 'pending' | 'approved' | 'rejected';
  requesterPlatformUserId!: string;
  approvedByPlatformUserId!: string | null;
  approvedAt!: Date | null;
  approvalNotes!: string | null;
  changeResult!: 'pending' | 'success' | 'failed' | 'rejected' | null;
  errorMessage!: string | null;
  createdAt!: Date;
  rolledBack!: boolean;
}

export class ApprovalResponseDto {
  _id!: string;
  changeId!: string;
  approvalStatus!: 'approved' | 'rejected';
  approvedAt!: Date;
  changeResult!: 'success' | 'failed' | 'pending';
  errorMessage!: string | null;
  message!: string;
}

export class SchemaVersionListResponseDto {
  versions!: SchemaVersionDto[];
  total!: number;
  limit!: number;
  offset!: number;
}

export class SchemaTablesListResponseDto {
  tables!: SchemaTableDto[];
  total!: number;
  limit!: number;
  offset!: number;
  versionId!: string;
}

export class SchemaChangeLogListResponseDto {
  changes!: SchemaChangeLogDto[];
  total!: number;
  limit!: number;
  offset!: number;
}
