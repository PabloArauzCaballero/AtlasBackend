/**
 * @file Adaptador HTTP: valida y autoriza la petición antes de delegar el caso de uso.
 * @business Esta pieza publica el árbol de endpoints del proceso estándar para que cliente y portal no dupliquen su lógica.
 * @system expone el catálogo versionado de flujos, etapas, pasos, dependencias y transiciones.
 */
import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiOperation, ApiParam, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { CurrentTenant } from '../../common/decorators/current-tenant.decorator.js';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import { Roles } from '../../common/decorators/roles.decorator.js';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard.js';
import { RolesGuard } from '../../common/guards/roles.guard.js';
import { TenantGuard } from '../../common/guards/tenant.guard.js';
import { zodToApiSchema } from '../../common/openapi/zod-to-schema.util.js';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import { AuthenticatedUser } from '../../common/types/auth.types.js';
import { CustomerIdParamsDto, customerIdParamsSchema } from '../customers/customers.schemas.js';
import { WORKFLOW_PROGRESS_ROLES } from './workflow-catalog.constants.js';
import { WorkflowProgressQueryDto, workflowProgressQuerySchema } from './workflow-catalog.schemas.js';
import { WorkflowProgressService } from './application/workflow-progress.service.js';

/**
 * Avance de un cliente concreto sobre el flujo declarado.
 *
 * Responde a la pregunta que el frontend hacía reconstruyendo el proceso por su cuenta: qué etapas
 * ya cumplió, cuáles faltan y cuál es la SIGUIENTE llamada HTTP que corresponde hacer. El estado sale
 * de la misma evaluación de habilitación que usa el backend para decidir el acceso al crédito, así
 * que la pantalla de avance y la puerta de entrada no pueden discrepar.
 */
@ApiTags('workflow-catalog')
@ApiBearerAuth('access-token')
@Controller('customers/:customerId')
@UseGuards(JwtAuthGuard, TenantGuard, RolesGuard)
@Roles(...WORKFLOW_PROGRESS_ROLES)
export class WorkflowProgressController {
  constructor(private readonly progressService: WorkflowProgressService) {}

  @ApiOperation({
    summary: 'Avance del cliente dentro del flujo estándar',
    description:
      'Devuelve etapas completadas, pendientes y bloqueadas, el porcentaje de avance y el siguiente paso válido ' +
      '(método, ruta y roles). Un `customer` solo puede consultar su propio avance.',
  })
  @ApiHeader({ name: 'x-tenant-id', required: false, description: 'Opcional para `customer` (se toma del token).' })
  @ApiParam({ name: 'customerId', schema: zodToApiSchema(customerIdParamsSchema.shape.customerId) })
  @ApiQuery({ name: 'workflowCode', required: false, description: 'Por defecto, el recorrido estándar del cliente.' })
  @ApiQuery({ name: 'version', required: false, description: '`latest` o una versión concreta (`v1`).' })
  @ApiResponse({ status: 200, description: 'Avance del cliente, con la siguiente llamada a realizar.' })
  @ApiResponse({ status: 403, description: 'Un customer intentó consultar el avance de otro cliente.' })
  @ApiResponse({ status: 404, description: 'WORKFLOW_NOT_FOUND o cliente no encontrado.' })
  @Get('workflow-progress')
  getProgress(
    @CurrentTenant() tenantId: string,
    @Param(new ZodValidationPipe(customerIdParamsSchema)) params: CustomerIdParamsDto,
    @Query(new ZodValidationPipe(workflowProgressQuerySchema)) query: WorkflowProgressQueryDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    return this.progressService.getProgress({ tenantId, customerId: params.customerId, currentUser, query });
  }
}
