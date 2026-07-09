import { Body, Controller, Get, HttpCode, HttpStatus, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiOperation, ApiParam, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { zodObjectPropertySchemas, zodToApiSchema } from '../../common/openapi/zod-to-schema.util.js';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard.js';
import { RolesGuard } from '../../common/guards/roles.guard.js';
import { Roles } from '../../common/decorators/roles.decorator.js';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import type { AuthenticatedUser } from '../../common/types/auth.types.js';
import { SchemaManagementService } from './services/schema-management.service.js';
import {
  approveSchemaChangeRequestSchema,
  createSchemaTableRequestSchema,
  schemaChangeLogQuerySchema,
  schemaTablesListQuerySchema,
  schemaVersionsListQuerySchema,
} from './schema-management.schemas.js';
import type {
  ApproveSchemaChangeRequest,
  CreateSchemaTableRequest,
  SchemaChangeLogQuery,
  SchemaTablesListQuery,
  SchemaVersionsListQuery,
} from './schema-management.schemas.js';

/**
 * SchemaManagementController — Fase 4B
 *
 * Endpoints DDL de solo-catálogo:
 * - Lectura: versiones, tablas, columnas, FK, change-log (roles internos + auditores).
 * - Escritura: proponer tabla (operadores), aprobar/rechazar (platform_admin, 4 ojos).
 *
 * La autorización fina (quién propone vs quién aprueba, y el principio de 4 ojos)
 * vive en SchemaManagementService; los @Roles de aquí son la primera barrera.
 */

@ApiTags('schema-management')
@ApiBearerAuth('access-token')
@Controller('operations/schema')
@UseGuards(JwtAuthGuard, RolesGuard)
export class SchemaManagementController {
  constructor(private readonly schemaService: SchemaManagementService) {}

  @ApiOperation({ summary: 'Listar versiones de esquema (catálogo DDL)' })
  @ApiQuery({ name: 'limit', required: false, schema: zodObjectPropertySchemas(schemaVersionsListQuerySchema).limit })
  @ApiQuery({ name: 'offset', required: false, schema: zodObjectPropertySchemas(schemaVersionsListQuerySchema).offset })
  @ApiQuery({ name: 'includeInactive', required: false, schema: zodObjectPropertySchemas(schemaVersionsListQuerySchema).includeInactive })
  @ApiResponse({ status: 200, description: 'Lista paginada de versiones de esquema.' })
  @Get('versions')
  @Roles('internal_operator', 'admin', 'platform_admin', 'risk_analyst', 'readonly_auditor')
  listVersions(
    @Query(new ZodValidationPipe(schemaVersionsListQuerySchema))
    query: SchemaVersionsListQuery,
  ) {
    return this.schemaService.listSchemaVersions(query.limit, query.offset, query.includeInactive);
  }

  @ApiOperation({ summary: 'Obtener una versión de esquema' })
  @ApiParam({ name: 'versionId' })
  @ApiResponse({ status: 200, description: 'Detalle de la versión de esquema.' })
  @ApiResponse({ status: 404, description: 'SCHEMA_VERSION_NOT_FOUND.' })
  @Get('versions/:versionId')
  @Roles('internal_operator', 'admin', 'platform_admin', 'risk_analyst', 'readonly_auditor')
  getVersion(@Param('versionId') versionId: string) {
    return this.schemaService.getSchemaVersion(versionId);
  }

  @ApiOperation({ summary: 'Listar tablas del catálogo de esquema' })
  @ApiQuery({ name: 'versionId', required: false, schema: zodObjectPropertySchemas(schemaTablesListQuerySchema).versionId })
  @ApiQuery({ name: 'tableType', required: false, schema: zodObjectPropertySchemas(schemaTablesListQuerySchema).tableType })
  @ApiQuery({ name: 'limit', required: false, schema: zodObjectPropertySchemas(schemaTablesListQuerySchema).limit })
  @ApiQuery({ name: 'offset', required: false, schema: zodObjectPropertySchemas(schemaTablesListQuerySchema).offset })
  @ApiResponse({ status: 200, description: 'Lista paginada de tablas.' })
  @Get('tables')
  @Roles('internal_operator', 'admin', 'platform_admin', 'risk_analyst', 'readonly_auditor')
  listTables(
    @Query(new ZodValidationPipe(schemaTablesListQuerySchema))
    query: SchemaTablesListQuery,
  ) {
    return this.schemaService.listSchemaTables(query.versionId, query.tableType, query.limit, query.offset);
  }

  @ApiOperation({ summary: 'Obtener una tabla del catálogo de esquema (con columnas y FKs)' })
  @ApiParam({ name: 'tableId' })
  @ApiResponse({ status: 200, description: 'Detalle de la tabla.' })
  @ApiResponse({ status: 404, description: 'SCHEMA_TABLE_NOT_FOUND.' })
  @Get('tables/:tableId')
  @Roles('internal_operator', 'admin', 'platform_admin', 'risk_analyst', 'readonly_auditor')
  getTable(@Param('tableId') tableId: string) {
    return this.schemaService.getSchemaTable(tableId);
  }

  @ApiOperation({
    summary: 'Proponer una tabla nueva (solo-catálogo, no ejecuta DDL)',
    description: 'Registra una propuesta de cambio de esquema pendiente de aprobación (4 ojos) por platform_admin.',
  })
  @ApiBody({ schema: zodToApiSchema(createSchemaTableRequestSchema) })
  @ApiResponse({ status: 201, description: 'Propuesta de tabla registrada.' })
  @Post('tables')
  @Roles('internal_operator', 'admin', 'platform_admin')
  @HttpCode(HttpStatus.CREATED)
  proposeTable(
    @Body(new ZodValidationPipe(createSchemaTableRequestSchema))
    data: CreateSchemaTableRequest,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.schemaService.proposeNewTable(data, user);
  }

  @ApiOperation({ summary: 'Listar el change-log de propuestas de esquema' })
  @ApiQuery({ name: 'approvalStatus', required: false, schema: zodObjectPropertySchemas(schemaChangeLogQuerySchema).approvalStatus })
  @ApiQuery({ name: 'changeType', required: false, schema: zodObjectPropertySchemas(schemaChangeLogQuerySchema).changeType })
  @ApiQuery({ name: 'requesterUserId', required: false, schema: zodObjectPropertySchemas(schemaChangeLogQuerySchema).requesterUserId })
  @ApiQuery({ name: 'limit', required: false, schema: zodObjectPropertySchemas(schemaChangeLogQuerySchema).limit })
  @ApiQuery({ name: 'offset', required: false, schema: zodObjectPropertySchemas(schemaChangeLogQuerySchema).offset })
  @ApiResponse({ status: 200, description: 'Lista paginada del change-log.' })
  @Get('change-log')
  @Roles('internal_operator', 'admin', 'platform_admin', 'risk_analyst', 'readonly_auditor')
  listChangeLog(
    @Query(new ZodValidationPipe(schemaChangeLogQuerySchema))
    query: SchemaChangeLogQuery,
  ) {
    return this.schemaService.listSchemaChangeLog(query.approvalStatus, query.changeType, query.requesterUserId, query.limit, query.offset);
  }

  @ApiOperation({
    summary: 'Aprobar o rechazar una propuesta de cambio de esquema',
    description: 'Exclusivo de platform_admin (segundo par de ojos). Rechazar requiere approvalNotes.',
  })
  @ApiParam({ name: 'changeId' })
  @ApiBody({ schema: zodToApiSchema(approveSchemaChangeRequestSchema) })
  @ApiResponse({ status: 200, description: 'Decisión aplicada.' })
  @ApiResponse({ status: 404, description: 'SCHEMA_CHANGE_NOT_FOUND.' })
  @ApiResponse({ status: 409, description: 'SCHEMA_CHANGE_ALREADY_DECIDED.' })
  @Patch('change-log/:changeId/approve')
  @Roles('platform_admin')
  @HttpCode(HttpStatus.OK)
  approveChange(
    @Param('changeId') changeId: string,
    @Body(new ZodValidationPipe(approveSchemaChangeRequestSchema))
    data: ApproveSchemaChangeRequest,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.schemaService.approveSchemaChange(changeId, data, user);
  }
}
