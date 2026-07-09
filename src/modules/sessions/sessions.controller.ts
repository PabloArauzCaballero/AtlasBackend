import { BadRequestException, Body, Controller, Get, Headers, HttpCode, HttpStatus, Param, Post, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiHeader, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { zodToApiSchema } from '../../common/openapi/zod-to-schema.util.js';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import { Roles } from '../../common/decorators/roles.decorator.js';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard.js';
import { RolesGuard } from '../../common/guards/roles.guard.js';
import { TenantGuard } from '../../common/guards/tenant.guard.js';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import { AuthenticatedUser } from '../../common/types/auth.types.js';
import { parsePositiveId } from '../../common/utils/ids/id.util.js';
import { SessionsService } from './sessions.service.js';
import {
  EndSessionDto,
  OperationSessionParamsDto,
  SessionHeartbeatDto,
  SessionParamsDto,
  StartSessionDto,
  StartSessionParamsDto,
  endSessionSchema,
  operationSessionParamsSchema,
  sessionHeartbeatSchema,
  sessionParamsSchema,
  startSessionParamsSchema,
  startSessionSchema,
} from './sessions.schemas.js';

type RequestWithNetwork = {
  ip?: string;
  headers: Record<string, string | string[] | undefined>;
};

function firstHeader(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

function userAgentFrom(request: RequestWithNetwork): string | null {
  return firstHeader(request.headers['user-agent']);
}

@ApiTags('sessions')
@ApiBearerAuth('access-token')
@Controller('customers/:customerId')
@UseGuards(JwtAuthGuard, TenantGuard, RolesGuard)
@Roles('customer', 'internal_operator', 'risk_analyst', 'compliance_analyst', 'fraud_analyst', 'admin', 'platform_admin', 'system')
export class CustomerSessionsController {
  constructor(private readonly sessionsService: SessionsService) {}

  @ApiOperation({
    summary: 'Iniciar una sesión de cliente',
    description:
      'Abre una nueva sesión (login en la app móvil/web del cliente) asociada a un dispositivo. Un `customer` solo puede abrir ' +
      'sesiones para sí mismo (`assertOwnCustomerResource`); los roles internos pueden operar en nombre de cualquier cliente.',
  })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  @ApiHeader({ name: 'x-idempotency-key', required: true })
  @ApiParam({ name: 'customerId', schema: zodToApiSchema(startSessionParamsSchema.shape.customerId) })
  @ApiBody({ schema: zodToApiSchema(startSessionSchema) })
  @ApiResponse({ status: 201, description: 'Sesión creada.' })
  @ApiResponse({ status: 400, description: 'X-Idempotency-Key ausente, o x-tenant-id inválido.' })
  @ApiResponse({ status: 403, description: 'El dispositivo no está vinculado al cliente.' })
  @ApiResponse({ status: 404, description: 'Cliente o dispositivo no encontrado.' })
  @ApiResponse({ status: 422, description: 'CUSTOMER_BLOCKED — el cliente está bloqueado.' })
  @Post('sessions/start')
  @HttpCode(HttpStatus.CREATED)
  startSession(
    @Headers('x-tenant-id') tenantIdHeader: string | undefined,
    @Headers('x-idempotency-key') idempotencyKey: string | undefined,
    @Param(new ZodValidationPipe(startSessionParamsSchema)) params: StartSessionParamsDto,
    @Body(new ZodValidationPipe(startSessionSchema)) body: StartSessionDto,
    @CurrentUser() currentUser: AuthenticatedUser,
    @Req() request: RequestWithNetwork,
  ) {
    if (!idempotencyKey) throw new BadRequestException('X-Idempotency-Key header is required.');
    return this.sessionsService.startSession({
      customerId: params.customerId,
      body,
      currentUser,
      context: {
        tenantId: parsePositiveId(String(tenantIdHeader ?? ''), 'x-tenant-id'),
        ipAddress: request.ip ?? null,
        userAgent: userAgentFrom(request),
        idempotencyKey,
      },
    });
  }

  @ApiOperation({
    summary: 'Heartbeat de sesión',
    description:
      'Señal periódica de actividad de una sesión abierta (mantiene la sesión viva y actualiza GPS/telemetría de dispositivo). ' +
      'Valida que el `deviceId` enviado coincida con el de la sesión.',
  })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  @ApiHeader({ name: 'x-idempotency-key', required: true })
  @ApiParam({ name: 'customerId', schema: zodToApiSchema(sessionParamsSchema.shape.customerId) })
  @ApiParam({ name: 'sessionId', schema: zodToApiSchema(sessionParamsSchema.shape.sessionId) })
  @ApiBody({ schema: zodToApiSchema(sessionHeartbeatSchema) })
  @ApiResponse({ status: 202, description: 'Heartbeat registrado.' })
  @ApiResponse({ status: 403, description: 'El dispositivo no corresponde a la sesión.' })
  @ApiResponse({ status: 404, description: 'Sesión no encontrada.' })
  @ApiResponse({ status: 422, description: 'SESSION_NOT_ACTIVE — la sesión ya no está activa.' })
  @Post('sessions/:sessionId/heartbeat')
  @HttpCode(HttpStatus.ACCEPTED)
  heartbeat(
    @Headers('x-tenant-id') tenantIdHeader: string | undefined,
    @Headers('x-idempotency-key') idempotencyKey: string | undefined,
    @Param(new ZodValidationPipe(sessionParamsSchema)) params: SessionParamsDto,
    @Body(new ZodValidationPipe(sessionHeartbeatSchema)) body: SessionHeartbeatDto,
    @CurrentUser() currentUser: AuthenticatedUser,
    @Req() request: RequestWithNetwork,
  ) {
    if (!idempotencyKey) throw new BadRequestException('X-Idempotency-Key header is required.');
    return this.sessionsService.heartbeat({
      customerId: params.customerId,
      sessionId: params.sessionId,
      body,
      currentUser,
      context: {
        tenantId: parsePositiveId(String(tenantIdHeader ?? ''), 'x-tenant-id'),
        ipAddress: request.ip ?? null,
        userAgent: userAgentFrom(request),
        idempotencyKey,
      },
    });
  }

  @ApiOperation({ summary: 'Cerrar sesión', description: 'Termina explícitamente una sesión abierta (logout).' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  @ApiHeader({ name: 'x-idempotency-key', required: true })
  @ApiParam({ name: 'customerId', schema: zodToApiSchema(sessionParamsSchema.shape.customerId) })
  @ApiParam({ name: 'sessionId', schema: zodToApiSchema(sessionParamsSchema.shape.sessionId) })
  @ApiBody({ schema: zodToApiSchema(endSessionSchema) })
  @ApiResponse({ status: 200, description: 'Sesión cerrada.' })
  @ApiResponse({ status: 403, description: 'El dispositivo no corresponde a la sesión.' })
  @ApiResponse({ status: 404, description: 'Sesión no encontrada.' })
  @Post('sessions/:sessionId/end')
  @HttpCode(HttpStatus.OK)
  endSession(
    @Headers('x-tenant-id') tenantIdHeader: string | undefined,
    @Headers('x-idempotency-key') idempotencyKey: string | undefined,
    @Param(new ZodValidationPipe(sessionParamsSchema)) params: SessionParamsDto,
    @Body(new ZodValidationPipe(endSessionSchema)) body: EndSessionDto,
    @CurrentUser() currentUser: AuthenticatedUser,
    @Req() request: RequestWithNetwork,
  ) {
    if (!idempotencyKey) throw new BadRequestException('X-Idempotency-Key header is required.');
    return this.sessionsService.endSession({
      customerId: params.customerId,
      sessionId: params.sessionId,
      body,
      currentUser,
      context: {
        tenantId: parsePositiveId(String(tenantIdHeader ?? ''), 'x-tenant-id'),
        ipAddress: request.ip ?? null,
        userAgent: userAgentFrom(request),
        idempotencyKey,
      },
    });
  }

  @ApiOperation({
    summary: 'Estado de sesión actual del cliente',
    description: 'Devuelve si el cliente tiene una sesión activa en este momento y su resumen (dispositivo, inicio, última actividad).',
  })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  @ApiParam({ name: 'customerId', schema: zodToApiSchema(startSessionParamsSchema.shape.customerId) })
  @ApiResponse({ status: 200, description: 'Estado de sesión (puede no haber ninguna sesión activa).' })
  @ApiResponse({ status: 404, description: 'Cliente no encontrado.' })
  @Get('session-state')
  getSessionState(
    @Headers('x-tenant-id') tenantIdHeader: string | undefined,
    @Param(new ZodValidationPipe(startSessionParamsSchema)) params: StartSessionParamsDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    return this.sessionsService.getSessionState({
      tenantId: parsePositiveId(String(tenantIdHeader ?? ''), 'x-tenant-id'),
      customerId: params.customerId,
      currentUser,
    });
  }
}

@ApiTags('sessions')
@ApiBearerAuth('access-token')
@Controller('operations/sessions')
@UseGuards(JwtAuthGuard, TenantGuard, RolesGuard)
@Roles('internal_operator', 'risk_analyst', 'compliance_analyst', 'fraud_analyst', 'admin', 'platform_admin', 'system')
export class OperationsSessionsController {
  constructor(private readonly sessionsService: SessionsService) {}

  @ApiOperation({
    summary: 'Resumen de investigación de una sesión (operaciones)',
    description:
      'Vista interna de una sesión para investigación de fraude/soporte: dispositivo, GPS, eventos de riesgo, y actividad asociada. ' +
      'Exclusivamente para roles internos — nunca para `customer` (a diferencia de los endpoints de `CustomerSessionsController`).',
  })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  @ApiParam({ name: 'sessionId', schema: zodToApiSchema(operationSessionParamsSchema.shape.sessionId) })
  @ApiResponse({ status: 200, description: 'Resumen de investigación de la sesión.' })
  @ApiResponse({ status: 404, description: 'Sesión no encontrada.' })
  @Get(':sessionId/investigation-summary')
  getInvestigationSummary(
    @Headers('x-tenant-id') tenantIdHeader: string | undefined,
    @Param(new ZodValidationPipe(operationSessionParamsSchema)) params: OperationSessionParamsDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    return this.sessionsService.getOperationsSessionSummary({
      tenantId: parsePositiveId(String(tenantIdHeader ?? ''), 'x-tenant-id'),
      sessionId: params.sessionId,
      currentUser,
    });
  }
}
