import { BadRequestException, Body, Controller, Get, Headers, HttpCode, HttpStatus, Param, Post, Query, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Roles } from '../../common/decorators/roles.decorator.js';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard.js';
import { RolesGuard } from '../../common/guards/roles.guard.js';
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
@Controller('operations/events')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('internal_operator', 'risk_analyst', 'compliance_analyst', 'fraud_analyst', 'admin', 'platform_admin', 'system')
export class EventsController {
  constructor(private readonly eventsService: EventsService) {}

  @Get('catalog')
  listCatalog() {
    return { data: this.eventsService.listDefinitions() };
  }

  @Get()
  listEvents(
    @Headers('x-tenant-id') tenantIdHeader: string | undefined,
    @Query(new ZodValidationPipe(listEventsQuerySchema)) query: ListEventsQueryDto,
  ) {
    return this.eventsService.listEvents(tenantIdFromHeader(tenantIdHeader), query);
  }

  @Get(':eventId')
  getEvent(
    @Headers('x-tenant-id') tenantIdHeader: string | undefined,
    @Param(new ZodValidationPipe(eventIdParamsSchema)) params: EventIdParamsDto,
  ) {
    return this.eventsService.getEvent(tenantIdFromHeader(tenantIdHeader), params.eventId);
  }

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
