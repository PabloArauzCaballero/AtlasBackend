/**
 * @file Servicio de aplicación o dominio: ejecuta reglas y coordina dependencias.
 * @business Esta pieza gobierna propuestas de estructura sin permitir DDL directo desde el portal.
 * @system valida y audita el catálogo de cambios; la ejecución física permanece en migraciones revisadas.
 */
import { BadRequestException, ConflictException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { AuthenticatedUser } from '../../../common/types/auth.types.js';
import { SchemaChangeLogRepository, type SchemaChangeLogFilters } from '../schema-change-log.repository.js';
import { SchemaManagementValidationService } from './schema-management-validation.service.js';
import { mapChangeLogRow } from './schema-management.mapper.js';
import {
  PLATFORM_APPROVER_ROLES,
  PLATFORM_PROPOSER_ROLES,
  describeActor,
  requesterOf,
  resolveSchemaChangeActor,
  sameActor,
} from './schema-change-actor.js';
import type { ApproveSchemaChangeRequest, CreateSchemaTableRequest } from '../schema-management.schemas.js';
import { ApprovalResponseDto, SchemaChangeLogDto, SchemaChangeLogListResponseDto } from '../schema-management.dtos.js';

/**
 * SchemaManagementService — Fase 4B
 *
 * Orquesta el ciclo de vida de cambios DDL sobre el catálogo de schema:
 * proponer (pending) → aprobar/rechazar (otra persona) → registrar resultado.
 *
 * Quién puede: una sesión INTERNA con `governance.schema.propose` / `governance.schema.approve`
 * (lo exige `SchemaChangeAuthorizationGuard`), o una sesión de PLATAFORMA con su rol de sesión
 * (ver `schema-change-actor.ts`). El actor se registra con su población.
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

@Injectable()
export class SchemaManagementService {
  private readonly logger = new Logger(SchemaManagementService.name);

  constructor(
    // La auditoría de propuestas vive en su propio repositorio: es una responsabilidad distinta
    // de leer el inventario, con su propio lock pesimista al resolver.
    private readonly changeLog: SchemaChangeLogRepository,
    private readonly validation: SchemaManagementValidationService,
  ) {}

  // =========================================================================
  // PROPOSE (POST /tables)
  // =========================================================================

  async proposeNewTable(data: CreateSchemaTableRequest, currentUser: AuthenticatedUser): Promise<SchemaChangeLogDto> {
    const requester = resolveSchemaChangeActor(currentUser, PLATFORM_PROPOSER_ROLES, 'propose schema changes');

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

    const entry = await this.changeLog.createChangeLogEntry({
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
      requesterPlatformUserId: requester.kind === 'platform' ? requester.id : null,
      requesterInternalUserId: requester.kind === 'internal' ? requester.id : null,
    });

    this.logger.log(
      `Schema change proposed: changeId=${entry._id} type=CREATE_TABLE table=${data.tableName} requester=${describeActor(requester)}`,
    );

    return mapChangeLogRow(entry);
  }

  // =========================================================================
  // APPROVE / REJECT (PATCH /change-log/:id/approve)
  // =========================================================================

  async approveSchemaChange(
    changeId: string,
    data: ApproveSchemaChangeRequest,
    currentUser: AuthenticatedUser,
  ): Promise<ApprovalResponseDto> {
    const approver = resolveSchemaChangeActor(currentUser, PLATFORM_APPROVER_ROLES, 'approve schema changes');

    const updated = await this.changeLog.withTransaction(async (transaction) => {
      // Lock pesimista: previene doble aprobación concurrente del mismo cambio.
      const entry = await this.changeLog.getChangeLogEntryForUpdate(changeId, transaction);

      if (!entry) {
        throw new NotFoundException(`Schema change ${changeId} not found`);
      }

      if (entry.approval_status !== 'pending') {
        throw new ConflictException(
          `Cannot resolve change with status "${entry.approval_status}". Only "pending" changes can be approved or rejected.`,
        );
      }

      // Principio de 4 ojos: el aprobador no puede ser quien propuso el cambio.
      if (sameActor(requesterOf(entry), approver)) {
        throw new ForbiddenException('Segregation of duties: the requester of a schema change cannot approve their own change.');
      }

      const approving = data.approval === 'approve';

      return this.changeLog.resolveChangeLogEntry(
        changeId,
        {
          approvalStatus: approving ? 'approved' : 'rejected',
          approvedByPlatformUserId: approver.kind === 'platform' ? approver.id : null,
          approvedByInternalUserId: approver.kind === 'internal' ? approver.id : null,
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

    this.logger.log(`Schema change resolved: changeId=${changeId} status=${updated.approval_status} approver=${describeActor(approver)}`);

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

  async listSchemaChangeLog(filters: SchemaChangeLogFilters, limit = 50, offset = 0): Promise<SchemaChangeLogListResponseDto> {
    const { rows, total } = await this.changeLog.listChangeLog(filters, limit, offset);

    return {
      changes: rows.map((row) => mapChangeLogRow(row)),
      total,
      limit,
      offset,
    };
  }
}
