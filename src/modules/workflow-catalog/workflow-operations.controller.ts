/**
 * @file Adaptador HTTP: valida y autoriza la petición antes de delegar el caso de uso.
 * @business Esta pieza publica el árbol de endpoints del proceso estándar para que cliente y portal no dupliquen su lógica.
 * @system expone el catálogo versionado de flujos, etapas, pasos, dependencias y transiciones.
 */
import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Roles } from '../../common/decorators/roles.decorator.js';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard.js';
import { RolesGuard } from '../../common/guards/roles.guard.js';
import { zodToApiSchema } from '../../common/openapi/zod-to-schema.util.js';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import { WORKFLOW_CATALOG_GOVERNANCE_ROLES } from './workflow-catalog.constants.js';
import {
  WorkflowCodeParamsDto,
  WorkflowVersionQueryDto,
  workflowCodeParamsSchema,
  workflowVersionQuerySchema,
} from './workflow-catalog.schemas.js';
import { WorkflowConsistencyService } from './application/workflow-consistency.service.js';

/**
 * Gobierno del catálogo de flujos: ¿sigue describiendo el backend que está corriendo?
 *
 * Se separa del controlador de lectura porque el informe expone rutas, controladores y handlers que
 * un cliente de la app no tiene por qué conocer; y porque su consumidor natural es el portal interno
 * y CI, no la aplicación del cliente.
 */
@ApiTags('workflow-catalog')
@ApiBearerAuth('access-token')
@Controller('operations/workflows')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(...WORKFLOW_CATALOG_GOVERNANCE_ROLES)
export class WorkflowOperationsController {
  constructor(private readonly consistencyService: WorkflowConsistencyService) {}

  @ApiOperation({
    summary: 'Informe de consistencia del flujo contra los endpoints reales',
    description:
      'Compara cada paso sembrado con las rutas que ESTE proceso tiene montadas: ruta inexistente, código de endpoint ' +
      'incoherente, estado de ciclo de vida desconocido (errores); roles divergentes, endpoint aún no descubierto y ' +
      'rutas del mismo dominio sin mapear (avisos). `status` es `drift_detected` si hay al menos un error.',
  })
  @ApiParam({ name: 'workflowCode', schema: zodToApiSchema(workflowCodeParamsSchema.shape.workflowCode) })
  @ApiQuery({ name: 'version', required: false, description: '`latest` o una versión concreta (`v1`).' })
  @ApiResponse({ status: 200, description: 'Informe de consistencia con la lista completa de hallazgos.' })
  @ApiResponse({ status: 404, description: 'WORKFLOW_NOT_FOUND.' })
  @Get(':workflowCode/consistency')
  checkConsistency(
    @Param(new ZodValidationPipe(workflowCodeParamsSchema)) params: WorkflowCodeParamsDto,
    @Query(new ZodValidationPipe(workflowVersionQuerySchema)) query: WorkflowVersionQueryDto,
  ) {
    return this.consistencyService.check(params.workflowCode, query.version);
  }
}
