import { BadRequestException, Body, Controller, Get, Headers, HttpCode, HttpStatus, Param, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiHeader, ApiOperation, ApiParam, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { zodObjectPropertySchemas, zodToApiSchema } from '../../common/openapi/zod-to-schema.util.js';
import { Roles } from '../../common/decorators/roles.decorator.js';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard.js';
import { RolesGuard } from '../../common/guards/roles.guard.js';
import { TenantGuard } from '../../common/guards/tenant.guard.js';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import { parsePositiveId } from '../../common/utils/ids/id.util.js';
import { EventsService } from './events.service.js';
import {
  eventIdParamsSchema,
  listEventsQuerySchema,
  publishEventSchema,
  EventIdParamsDto,
  ListEventsQueryDto,
  PublishEventDto,
} from './events.schemas.js';

function tenantIdFromHeader(value: string | undefined): string {
  return parsePositiveId(String(value ?? ''), 'x-tenant-id');
}

function requireIdempotencyKey(value: string | undefined): string {
  if (!value) throw new BadRequestException('X-Idempotency-Key header is required.');
  return value;
}

@ApiTags('events')
@ApiBearerAuth('access-token')
@Controller('operations/events')
@UseGuards(JwtAuthGuard, TenantGuard, RolesGuard)
@Roles('internal_operator', 'risk_analyst', 'compliance_analyst', 'fraud_analyst', 'admin', 'platform_admin', 'system')
export class EventsController {
  constructor(private readonly eventsService: EventsService) {}

  @ApiOperation({ summary: 'Catálogo de definiciones de eventos de dominio' })
  @ApiResponse({ status: 200, description: 'Lista de definiciones de eventos registradas.' })
  @Get('catalog')
  listCatalog() {
    return { data: this.eventsService.listDefinitions() };
  }

  @ApiOperation({ summary: 'Listar eventos de dominio (outbox)', description: 'Soporta paginación por offset (page/limit) o por cursor (pagination=cursor).' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  @ApiQuery({ name: 'status', required: false, schema: zodObjectPropertySchemas(listEventsQuerySchema).status })
  @ApiQuery({ name: 'eventCode', required: false, schema: zodObjectPropertySchemas(listEventsQuerySchema).eventCode })
  @ApiQuery({ name: 'aggregateType', required: false, schema: zodObjectPropertySchemas(listEventsQuerySchema).aggregateType })
  @ApiQuery({ name: 'correlationId', required: false, schema: zodObjectPropertySchemas(listEventsQuerySchema).correlationId })
  @ApiQuery({ name: 'page', required: false, schema: zodObjectPropertySchemas(listEventsQuerySchema).page })
  @ApiQuery({ name: 'limit', required: false, schema: zodObjectPropertySchemas(listEventsQuerySchema).limit })
  @ApiQuery({ name: 'pagination', required: false, schema: zodObjectPropertySchemas(listEventsQuerySchema).pagination })
  @ApiQuery({ name: 'cursor', required: false, schema: zodObjectPropertySchemas(listEventsQuerySchema).cursor })
  @ApiResponse({ status: 200, description: 'Lista paginada de eventos.' })
  @Get()
  listEvents(
    @Headers('x-tenant-id') tenantIdHeader: string | undefined,
    @Query(new ZodValidationPipe(listEventsQuerySchema)) query: ListEventsQueryDto,
  ) {
    return this.eventsService.listEvents(tenantIdFromHeader(tenantIdHeader), query);
  }

  @ApiOperation({ summary: 'Obtener un evento de dominio' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  @ApiParam({ name: 'eventId', schema: zodToApiSchema(eventIdParamsSchema.shape.eventId) })
  @ApiResponse({ status: 200, description: 'Detalle del evento.' })
  @ApiResponse({ status: 404, description: 'EVENT_NOT_FOUND.' })
  @Get(':eventId')
  getEvent(
    @Headers('x-tenant-id') tenantIdHeader: string | undefined,
    @Param(new ZodValidationPipe(eventIdParamsSchema)) params: EventIdParamsDto,
  ) {
    return this.eventsService.getEvent(tenantIdFromHeader(tenantIdHeader), params.eventId);
  }

  @ApiOperation({ summary: 'Publicar un evento de dominio' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  @ApiHeader({ name: 'x-idempotency-key', required: true })
  @ApiBody({ schema: zodToApiSchema(publishEventSchema) })
  @ApiResponse({ status: 201, description: 'Evento publicado (encolado en outbox).' })
  @Post()
  @HttpCode(HttpStatus.CREATED)
  createEvent(
    @Headers('x-tenant-id') tenantIdHeader: string | undefined,
    @Headers('x-idempotency-key') idempotencyKeyHeader: string | undefined,
    @Body(new ZodValidationPipe(publishEventSchema)) body: PublishEventDto,
  ) {
    return this.eventsService.publishFromDto({
      tenantId: tenantIdFromHeader(tenantIdHeader),
      body,
      idempotencyKey: requireIdempotencyKey(idempotencyKeyHeader),
    });
  }

  @ApiOperation({ summary: 'Reintentar un evento fallido' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  @ApiHeader({ name: 'x-idempotency-key', required: true })
  @ApiParam({ name: 'eventId', schema: zodToApiSchema(eventIdParamsSchema.shape.eventId) })
  @ApiResponse({ status: 200, description: 'Evento re-encolado para reintento.' })
  @ApiResponse({ status: 404, description: 'EVENT_NOT_FOUND.' })
  @ApiResponse({ status: 409, description: 'EVENT_NOT_RETRYABLE.' })
  @Post(':eventId/retry')
  @HttpCode(HttpStatus.OK)
  retryEvent(
    @Headers('x-tenant-id') tenantIdHeader: string | undefined,
    @Headers('x-idempotency-key') idempotencyKeyHeader: string | undefined,
    @Param(new ZodValidationPipe(eventIdParamsSchema)) params: EventIdParamsDto,
  ) {
    requireIdempotencyKey(idempotencyKeyHeader);
    return this.eventsService.retryEvent(tenantIdFromHeader(tenantIdHeader), params.eventId);
  }

  @ApiOperation({ summary: 'Cancelar un evento pendiente' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  @ApiHeader({ name: 'x-idempotency-key', required: true })
  @ApiParam({ name: 'eventId', schema: zodToApiSchema(eventIdParamsSchema.shape.eventId) })
  @ApiResponse({ status: 200, description: 'Evento cancelado.' })
  @ApiResponse({ status: 404, description: 'EVENT_NOT_FOUND.' })
  @ApiResponse({ status: 409, description: 'EVENT_NOT_CANCELLABLE.' })
  @Post(':eventId/cancel')
  @HttpCode(HttpStatus.OK)
  cancelEvent(
    @Headers('x-tenant-id') tenantIdHeader: string | undefined,
    @Headers('x-idempotency-key') idempotencyKeyHeader: string | undefined,
    @Param(new ZodValidationPipe(eventIdParamsSchema)) params: EventIdParamsDto,
  ) {
    requireIdempotencyKey(idempotencyKeyHeader);
    return this.eventsService.cancelEvent(tenantIdFromHeader(tenantIdHeader), params.eventId);
  }
}
