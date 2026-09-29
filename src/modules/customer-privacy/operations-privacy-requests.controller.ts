/**
 * @file Adaptador HTTP: la cola interna de solicitudes de derechos del titular.
 * @business Cumplimiento ve cada solicitud de privacidad, su plazo legal y la atiende dejando constancia.
 * @system lista, detalla y transiciona `data_subject_requests` con roles internos y permiso fino `privacy.requests.*`.
 */
import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiHeader, ApiOperation, ApiParam, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { CurrentTenant } from '../../common/decorators/current-tenant.decorator.js';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import { Roles } from '../../common/decorators/roles.decorator.js';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard.js';
import { RolesGuard } from '../../common/guards/roles.guard.js';
import { TenantGuard } from '../../common/guards/tenant.guard.js';
import { zodObjectPropertySchemas, zodToApiSchema } from '../../common/openapi/zod-to-schema.util.js';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import { AuthenticatedUser } from '../../common/types/auth.types.js';
import { InternalPermissionsGuard } from '../internal-users/guards/internal-permissions.guard.js';
import { InternalPermissions } from '../internal-users/internal-permissions.decorator.js';
import {
  type OperationsPrivacyRequestsQueryDto,
  operationsPrivacyRequestsQuerySchema,
  type PrivacyRequestParamsDto,
  privacyRequestParamsSchema,
  type PrivacyRequestTransitionDto,
  privacyRequestTransitionSchema,
} from './operations-privacy-requests.schemas.js';
import { OperationsPrivacyRequestsService } from './operations-privacy-requests.service.js';

const filtros = zodObjectPropertySchemas(operationsPrivacyRequestsQuerySchema);
type RequestWithIp = { ip?: string };

/**
 * Controlador aparte del de `customers/:customerId/privacy`: aquél lo usa el propio cliente y se abre
 * por su id; éste es transversal al tenant y sólo para personal interno. `@Roles` deja pasar a los
 * roles de aplicación de cumplimiento, auditoría y administración; el permiso fino decide quién lee
 * (`privacy.requests.read`) y quién mueve el estado (`privacy.requests.manage`).
 */
@ApiTags('customer-privacy')
@ApiBearerAuth('access-token')
@Controller('operations/privacy/data-subject-requests')
@UseGuards(JwtAuthGuard, TenantGuard, RolesGuard, InternalPermissionsGuard)
@Roles('compliance_analyst', 'readonly_auditor', 'admin', 'platform_admin')
export class OperationsPrivacyRequestsController {
  constructor(private readonly service: OperationsPrivacyRequestsService) {}

  @ApiOperation({
    summary: 'Solicitudes de derechos del titular del tenant',
    description:
      'Lista paginada de las solicitudes de acceso, rectificación, supresión, portabilidad, revocación, restricción u oposición, ' +
      'con su cliente y su responsable. El vencimiento (`dueAt`) se calcula a 15 días naturales desde la recepción y `overdue` ' +
      'marca las abiertas (received, in_progress) que ya lo pasaron. Las abiertas salen primero, la más antigua arriba; ' +
      '`summary` resume toda la cola del tenant, sin filtros.',
  })
  @ApiHeader({ name: 'x-tenant-id', required: true, description: 'Tenant de la sesión.' })
  @ApiQuery({ name: 'status', required: false, schema: filtros.status, description: 'received, in_progress, completed o rejected.' })
  @ApiQuery({ name: 'type', required: false, schema: filtros.type, description: 'Tipo de derecho pedido.' })
  @ApiQuery({
    name: 'overdue',
    required: false,
    schema: filtros.overdue,
    description: '`true`: sólo las abiertas con el plazo vencido; `false`: todas las demás.',
  })
  @ApiQuery({ name: 'customerId', required: false, schema: filtros.customerId, description: 'Sólo las solicitudes de este cliente.' })
  @ApiQuery({ name: 'q', required: false, schema: filtros.q, description: 'Parte del código de la solicitud o del código del cliente.' })
  @ApiQuery({ name: 'page', required: false, schema: filtros.page, description: 'Página, desde 1.' })
  @ApiQuery({ name: 'pageSize', required: false, schema: filtros.pageSize, description: 'Solicitudes por página (máximo 100).' })
  @ApiResponse({ status: 200, description: 'Página de solicitudes, metadatos de paginación y resumen de abiertas y vencidas.' })
  @ApiResponse({ status: 403, description: 'Sin el permiso privacy.requests.read.' })
  @InternalPermissions('privacy.requests.read')
  @Get()
  list(
    @CurrentTenant() tenantId: string,
    @Query(new ZodValidationPipe(operationsPrivacyRequestsQuerySchema)) query: OperationsPrivacyRequestsQueryDto,
  ) {
    return this.service.list(tenantId, query);
  }

  @ApiOperation({
    summary: 'Detalle de una solicitud del titular, con su historial',
    description:
      'La solicitud con su plazo calculado, las transiciones que admite desde su estado actual y el historial (creación y cada ' +
      'cambio de estado con autor, motivo y fecha) leído de la auditoría operativa.',
  })
  @ApiHeader({ name: 'x-tenant-id', required: true, description: 'Tenant de la sesión.' })
  @ApiParam({ name: 'requestId', schema: zodToApiSchema(privacyRequestParamsSchema.shape.requestId), description: 'Id de la solicitud.' })
  @ApiResponse({ status: 200, description: 'Solicitud, transiciones admitidas e historial.' })
  @ApiResponse({ status: 403, description: 'Sin el permiso privacy.requests.read.' })
  @ApiResponse({ status: 404, description: 'DATA_SUBJECT_REQUEST_NOT_FOUND — no existe en este tenant.' })
  @InternalPermissions('privacy.requests.read')
  @Get(':requestId')
  detail(@CurrentTenant() tenantId: string, @Param(new ZodValidationPipe(privacyRequestParamsSchema)) params: PrivacyRequestParamsDto) {
    return this.service.detail(tenantId, params.requestId);
  }

  @ApiOperation({
    summary: 'Mover una solicitud del titular de estado',
    description:
      'Máquina de estados explícita: received → in_progress → completed | rejected. Tomarla (`in_progress`) la asigna a quien la ' +
      'toma; `completed` y `rejected` exigen motivo (mínimo 10 caracteres), fechan el cierre (`resolvedAt`) y quedan en la ' +
      'auditoría con autor y estado anterior. `completed` significa que una persona ATENDIÓ la solicitud y dejó escrito cómo: ' +
      'esta ruta NO borra ni modifica datos del cliente. Una supresión se ejecuta a mano, respetando lo que la retención legal ' +
      'obliga a conservar (identidad, antifraude, historial de crédito).',
  })
  @ApiHeader({ name: 'x-tenant-id', required: true, description: 'Tenant de la sesión.' })
  @ApiParam({ name: 'requestId', schema: zodToApiSchema(privacyRequestParamsSchema.shape.requestId), description: 'Id de la solicitud.' })
  @ApiBody({ schema: zodToApiSchema(privacyRequestTransitionSchema) })
  @ApiResponse({ status: 200, description: 'Solicitud actualizada, con su historial.' })
  @ApiResponse({ status: 403, description: 'Sin el permiso privacy.requests.manage, o sin sesión interna.' })
  @ApiResponse({ status: 404, description: 'DATA_SUBJECT_REQUEST_NOT_FOUND — no existe en este tenant.' })
  @ApiResponse({ status: 409, description: 'DATA_SUBJECT_REQUEST_INVALID_TRANSITION — el estado actual no admite ese destino.' })
  @ApiResponse({ status: 422, description: 'DATA_SUBJECT_REQUEST_REASON_REQUIRED — cerrar exige motivo.' })
  @InternalPermissions('privacy.requests.manage')
  @Post(':requestId/transition')
  @HttpCode(HttpStatus.OK)
  transition(
    @CurrentTenant() tenantId: string,
    @Param(new ZodValidationPipe(privacyRequestParamsSchema)) params: PrivacyRequestParamsDto,
    @Body(new ZodValidationPipe(privacyRequestTransitionSchema)) body: PrivacyRequestTransitionDto,
    @CurrentUser() currentUser: AuthenticatedUser,
    @Req() request: RequestWithIp,
  ) {
    return this.service.transition({ tenantId, requestId: params.requestId, dto: body, currentUser, ipAddress: request.ip ?? null });
  }
}
