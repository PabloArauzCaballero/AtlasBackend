/**
 * @file Adaptador de mapeo: traduce filas de persistencia a DTO de transporte.
 * @business Esta pieza gobierna propuestas de estructura sin permitir DDL directo desde el portal.
 * @system valida y audita el catálogo de cambios; la ejecución física permanece en migraciones revisadas.
 */
import { SchemaChangeLogDto, SchemaTableDto, SchemaVersionDto } from '../schema-management.dtos.js';
import type { SchemaChangeLogRow, SchemaTableRow, SchemaVersionCounts, SchemaVersionRow } from '../schema-management.repository.js';

/**
 * Fila de Postgres → DTO. Son funciones libres y no métodos privados del servicio: no tocan
 * dependencias ni estado, y el servicio ya arrastraba deuda de tamaño congelada que no puede crecer.
 *
 * `mapTableRow` deja los contadores en cero a propósito: quien lista una página los rellena por
 * lotes y el detalle de una tabla los calcula de sus columnas. Ponerlos aquí obligaría a consultar
 * la base desde un mapeador.
 */

export function mapVersionRowWithCounts(row: SchemaVersionRow, counts: SchemaVersionCounts): SchemaVersionDto {
  const dto = new SchemaVersionDto();
  dto._id = row._id;
  dto.versionCode = row.version_code;
  dto.createdAt = row.created_at;
  dto.createdByPlatformUserId = row.created_by_platform_user_id;
  dto.notes = row.notes;
  dto.isActive = row.is_active;
  dto.parentVersionId = row.parent_version_id;
  dto.tablesCount = counts.tablesCount;
  dto.columnsCount = counts.columnsCount;
  dto.relationshipsCount = counts.relationshipsCount;
  return dto;
}

export function mapTableRow(row: SchemaTableRow): SchemaTableDto {
  const dto = new SchemaTableDto();
  dto._id = row._id;
  dto.schemaVersionId = row.schema_version_id;
  dto.tableName = row.table_name;
  dto.tableType = row.table_type;
  dto.isAppendOnly = row.is_append_only;
  dto.isTenantScoped = row.is_tenant_scoped;
  dto.description = row.description;
  dto.columnsCount = 0;
  dto.relationshipsCount = 0;
  dto.createdAt = row.created_at;
  return dto;
}

export function mapChangeLogRow(row: SchemaChangeLogRow): SchemaChangeLogDto {
  const dto = new SchemaChangeLogDto();
  dto._id = row._id;
  dto.changeId = row._id;
  dto.schemaVersionId = row.schema_version_id;
  dto.changeType = row.change_type;
  dto.affectedEntityType = row.affected_entity_type;
  dto.affectedEntityId = row.affected_entity_id;
  dto.changePayload = row.change_payload;
  dto.approvalStatus = row.approval_status;
  dto.requesterPlatformUserId = row.requester_platform_user_id;
  dto.approvedByPlatformUserId = row.approved_by_platform_user_id;
  dto.approvedAt = row.approved_at;
  dto.approvalNotes = row.approval_notes;
  dto.changeResult = row.change_result;
  dto.errorMessage = row.error_message;
  dto.createdAt = row.created_at;
  dto.rolledBack = row.rolled_back;
  return dto;
}
