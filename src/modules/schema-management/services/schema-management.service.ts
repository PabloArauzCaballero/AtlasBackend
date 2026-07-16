import { BadRequestException, ConflictException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { AuthenticatedUser } from '../../../common/types/auth.types.js';
import {
  SchemaManagementRepository,
  SchemaChangeLogRow,
  SchemaTableRow,
  SchemaVersionCounts,
  SchemaVersionRow,
} from '../schema-management.repository.js';
import { SchemaManagementValidationService } from './schema-management-validation.service.js';
import type { ApproveSchemaChangeRequest, CreateSchemaTableRequest } from '../schema-management.schemas.js';
import {
  ApprovalResponseDto,
  SchemaChangeLogDto,
  SchemaChangeLogListResponseDto,
  SchemaColumnDto,
  SchemaRelationshipDto,
  SchemaTableDto,
  SchemaTablesListResponseDto,
  SchemaVersionDto,
  SchemaVersionListResponseDto,
} from '../schema-management.dtos.js';

/**
 * SchemaManagementService — Fase 4B
 *
 * Orquesta el ciclo de vida de cambios DDL sobre el catálogo de schema:
 * proponer (pending) → aprobar/rechazar (platform_admin) → registrar resultado.
 *
 * Decisiones de robustez a largo plazo:
 * - 403 ForbiddenException para fallos de rol (401 es para autenticación, no autorización).
 * - Principio de 4 ojos: quien aprueba NO puede ser quien propuso (segregación de funciones,
 *   estándar en fintech para cambios sensibles).
 * - Lock pesimista (SELECT ... FOR UPDATE) al aprobar: dos admins aprobando el mismo cambio
 *   simultáneamente no pueden generar doble ejecución.
 * - La ejecución del DDL físico NO ocurre aquí en el MVP: aprobar registra la decisión en el
 *   catálogo; el DDL real sigue saliendo por migraciones Sequelize revisadas en PR.
 *   Ver docs/pending/pending-items.md para el seguimiento operativo.
 */

const PROPOSER_ROLES: ReadonlySet<string> = new Set(['internal_operator', 'admin', 'platform_admin']);
const APPROVER_ROLES: ReadonlySet<string> = new Set(['platform_admin']);

@Injectable()
export class SchemaManagementService {
  private readonly logger = new Logger(SchemaManagementService.name);

  constructor(
    private readonly repo: SchemaManagementRepository,
    private readonly validation: SchemaManagementValidationService,
  ) {}

  // =========================================================================
  // VERSIONS
  // =========================================================================

  async listSchemaVersions(limit = 20, offset = 0, includeInactive = false): Promise<SchemaVersionListResponseDto> {
    const { rows, total } = await this.repo.listSchemaVersions(limit, offset, includeInactive);

    // Batch: 3 queries agregadas (GROUP BY schema_version_id) para toda la página, en vez de 3
    // COUNT(*) por fila vía mapVersionRow (hasta 60 queries para una página de 20).
    const countsByVersion = await this.repo.countTablesColumnsRelationshipsForVersions(rows.map((row) => row._id));
    const emptyCounts: SchemaVersionCounts = { tablesCount: 0, columnsCount: 0, relationshipsCount: 0 };
    const versions = rows.map((row) => this.mapVersionRowWithCounts(row, countsByVersion.get(row._id) ?? emptyCounts));

    return { versions, total, limit, offset };
  }

  async getSchemaVersion(versionId: string): Promise<SchemaVersionDto> {
    const row = await this.repo.getSchemaVersion(versionId);
    if (!row) {
      throw new NotFoundException(`Schema version ${versionId} not found`);
    }
    return this.mapVersionRow(row);
  }

  // =========================================================================
  // TABLES
  // =========================================================================

  async listSchemaTables(versionId: string, tableType: string | undefined, limit = 50, offset = 0): Promise<SchemaTablesListResponseDto> {
    const version = await this.repo.getSchemaVersion(versionId);
    if (!version) {
      throw new NotFoundException(`Schema version ${versionId} not found`);
    }

    const { rows, total } = await this.repo.listSchemaTables(versionId, tableType, limit, offset);
    const tables = rows.map((row) => this.mapTableRow(row));

    return { tables, total, limit, offset, versionId };
  }

  async getSchemaTable(tableId: string): Promise<SchemaTableDto> {
    const table = await this.repo.getSchemaTable(tableId);
    if (!table) {
      throw new NotFoundException(`Schema table ${tableId} not found`);
    }

    const [columns, relationships] = await Promise.all([
      this.repo.getSchemaColumns(tableId),
      this.repo.getSchemaRelationshipsForTable(tableId),
    ]);

    const dto = this.mapTableRow(table);
    dto.columnsCount = columns.length;
    dto.relationshipsCount = relationships.length;

    dto.columns = columns.map((col) => {
      const colDto = new SchemaColumnDto();
      colDto._id = col._id;
      colDto.columnName = col.column_name;
      colDto.columnType = col.column_type;
      colDto.isNullable = col.is_nullable;
      colDto.isImmutable = col.is_immutable;
      colDto.isPii = col.is_pii;
      colDto.isIndexed = col.is_indexed;
      colDto.description = col.description;
      return colDto;
    });

    dto.relationships = relationships.map((rel) => {
      const relDto = new SchemaRelationshipDto();
      relDto._id = rel._id;
      relDto.sourceColumnName = rel.source_column_name;
      relDto.targetTableName = rel.target_table_name ?? 'unknown';
      relDto.targetColumnName = rel.target_column_name;
      relDto.cascadeDelete = rel.cascade_delete;
      relDto.isImmutable = rel.is_immutable;
      return relDto;
    });

    return dto;
  }

  // =========================================================================
  // PROPOSE (POST /tables)
  // =========================================================================

  async proposeNewTable(data: CreateSchemaTableRequest, currentUser: AuthenticatedUser): Promise<SchemaChangeLogDto> {
    this.assertRole(currentUser, PROPOSER_ROLES, 'propose schema changes');
    const requesterId = this.requirePlatformUserId(currentUser);

    const validation = await this.validation.validateNewTable({
      tableName: data.tableName,
      tableType: data.tableType,
      columns: data.columns,
      relationships: data.relationships,
    });

    if (!validation.valid) {
      throw new BadRequestException({
        message: 'Schema validation failed',
        errors: validation.errors,
      });
    }

    const entry = await this.repo.createChangeLogEntry({
      changeType: 'CREATE_TABLE',
      affectedEntityType: 'TABLE',
      changePayload: {
        tableName: data.tableName,
        tableType: data.tableType,
        isAppendOnly: data.isAppendOnly,
        isTenantScoped: data.isTenantScoped,
        description: data.description ?? null,
        columns: data.columns,
        relationships: data.relationships,
        justification: data.justification,
      },
      requesterPlatformUserId: requesterId,
    });

    this.logger.log(`Schema change proposed: changeId=${entry._id} type=CREATE_TABLE table=${data.tableName} requester=${requesterId}`);

    return this.mapChangeLogRow(entry);
  }

  // =========================================================================
  // APPROVE / REJECT (PATCH /change-log/:id/approve)
  // =========================================================================

  async approveSchemaChange(
    changeId: string,
    data: ApproveSchemaChangeRequest,
    currentUser: AuthenticatedUser,
  ): Promise<ApprovalResponseDto> {
    this.assertRole(currentUser, APPROVER_ROLES, 'approve schema changes');
    const approverId = this.requirePlatformUserId(currentUser);

    const updated = await this.repo.withTransaction(async (transaction) => {
      // Lock pesimista: previene doble aprobación concurrente del mismo cambio.
      const entry = await this.repo.getChangeLogEntryForUpdate(changeId, transaction);

      if (!entry) {
        throw new NotFoundException(`Schema change ${changeId} not found`);
      }

      if (entry.approval_status !== 'pending') {
        throw new ConflictException(
          `Cannot resolve change with status "${entry.approval_status}". Only "pending" changes can be approved or rejected.`,
        );
      }

      // Principio de 4 ojos: el aprobador no puede ser quien propuso el cambio.
      if (String(entry.requester_platform_user_id) === String(approverId)) {
        throw new ForbiddenException('Segregation of duties: the requester of a schema change cannot approve their own change.');
      }

      const approving = data.approval === 'approve';

      return this.repo.resolveChangeLogEntry(
        changeId,
        {
          approvalStatus: approving ? 'approved' : 'rejected',
          approvedByPlatformUserId: approverId,
          approvalNotes: data.approvalNotes ?? null,
          // El DDL físico sale por migraciones (ver nota de clase). Aprobar registra la
          // decisión; 'success' aquí significa "decisión registrada correctamente".
          changeResult: approving ? 'success' : 'rejected',
          errorMessage: null,
        },
        transaction,
      );
    });

    if (!updated) {
      // No debería pasar tras el lock, pero se maneja explícitamente.
      throw new NotFoundException(`Schema change ${changeId} disappeared during approval`);
    }

    this.logger.log(`Schema change resolved: changeId=${changeId} status=${updated.approval_status} approver=${approverId}`);

    const response = new ApprovalResponseDto();
    response._id = updated._id;
    response.changeId = updated._id;
    response.approvalStatus = updated.approval_status as 'approved' | 'rejected';
    response.approvedAt = updated.approved_at ?? new Date();
    response.changeResult = (updated.change_result ?? 'pending') as 'success' | 'failed' | 'pending';
    response.errorMessage = updated.error_message;
    response.message =
      data.approval === 'approve' ? `Schema change ${changeId} approved and recorded in change log` : `Schema change ${changeId} rejected`;
    return response;
  }

  // =========================================================================
  // CHANGE LOG (GET /change-log)
  // =========================================================================

  async listSchemaChangeLog(
    approvalStatus: string | undefined,
    changeType: string | undefined,
    requesterUserId: string | undefined,
    limit = 50,
    offset = 0,
  ): Promise<SchemaChangeLogListResponseDto> {
    const { rows, total } = await this.repo.listChangeLog(approvalStatus, changeType, requesterUserId, limit, offset);

    return {
      changes: rows.map((row) => this.mapChangeLogRow(row)),
      total,
      limit,
      offset,
    };
  }

  // =========================================================================
  // HELPERS
  // =========================================================================

  private assertRole(user: AuthenticatedUser, allowed: ReadonlySet<string>, action: string): void {
    if (!allowed.has(user.role)) {
      throw new ForbiddenException(`Role "${user.role}" is not allowed to ${action}. Allowed roles: ${[...allowed].join(', ')}.`);
    }
  }

  private requirePlatformUserId(user: AuthenticatedUser): string {
    if (!user.platformUserId) {
      throw new ForbiddenException('Schema management actions require an identified platform user (platformUserId missing in token).');
    }
    return user.platformUserId;
  }

  private async mapVersionRow(row: SchemaVersionRow): Promise<SchemaVersionDto> {
    const [tablesCount, columnsCount, relationshipsCount] = await Promise.all([
      this.repo.countTablesInVersion(row._id),
      this.repo.countColumnsInVersion(row._id),
      this.repo.countRelationshipsInVersion(row._id),
    ]);
    return this.mapVersionRowWithCounts(row, { tablesCount, columnsCount, relationshipsCount });
  }

  private mapVersionRowWithCounts(row: SchemaVersionRow, counts: SchemaVersionCounts): SchemaVersionDto {
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

  private mapTableRow(row: SchemaTableRow): SchemaTableDto {
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

  private mapChangeLogRow(row: SchemaChangeLogRow): SchemaChangeLogDto {
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
}
