import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import { Roles } from '../../common/decorators/roles.decorator.js';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard.js';
import { RolesGuard } from '../../common/guards/roles.guard.js';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import { AuthenticatedUser } from '../../common/types/auth.types.js';
import { parsePositiveId } from '../../common/utils/ids/id.util.js';
import { NotificationsService } from './notifications.service.js';
import {
  createTemplateSchema,
  customerNotificationIdParamsSchema,
  customerNotificationsParamsSchema,
  customerNotificationsQuerySchema,
  deviceTokenIdParamsSchema,
  listMessagesQuerySchema,
  listTemplatesQuerySchema,
  messageIdParamsSchema,
  preferencesParamsSchema,
  templateIdParamsSchema,
  updatePreferencesSchema,
  updateTemplateSchema,
  upsertDeviceTokenSchema,
  CreateTemplateDto,
  CustomerNotificationIdParamsDto,
  CustomerNotificationsParamsDto,
  CustomerNotificationsQueryDto,
  DeviceTokenIdParamsDto,
  ListMessagesQueryDto,
  ListTemplatesQueryDto,
  MessageIdParamsDto,
  PreferencesParamsDto,
  UpdatePreferencesDto,
  UpdateTemplateDto,
  UpsertDeviceTokenDto,
} from './notifications.schemas.js';

function tenantIdFromHeader(value: string | undefined, currentUser?: AuthenticatedUser): string {
  return parsePositiveId(String(value ?? currentUser?.tenantId ?? ''), 'x-tenant-id');
}

function requireIdempotencyKey(value: string | undefined): void {
  if (!value) throw new BadRequestException('X-Idempotency-Key header is required.');
}

@ApiTags('notifications')
@Controller()
@UseGuards(JwtAuthGuard, RolesGuard)
export class NotificationsController {
  constructor(private readonly service: NotificationsService) {}

  @Get('operations/notifications/messages')
  @Roles('internal_operator', 'risk_analyst', 'compliance_analyst', 'fraud_analyst', 'admin', 'platform_admin', 'system')
  listMessages(
    @Headers('x-tenant-id') tenantIdHeader: string | undefined,
    @Query(new ZodValidationPipe(listMessagesQuerySchema)) query: ListMessagesQueryDto,
  ) {
    return this.service.listMessages(tenantIdFromHeader(tenantIdHeader), query);
  }

  @Get('operations/notifications/messages/:messageId')
  @Roles('internal_operator', 'risk_analyst', 'compliance_analyst', 'fraud_analyst', 'admin', 'platform_admin', 'system')
  getMessage(
    @Headers('x-tenant-id') tenantIdHeader: string | undefined,
    @Param(new ZodValidationPipe(messageIdParamsSchema)) params: MessageIdParamsDto,
  ) {
    return this.service.getMessage(tenantIdFromHeader(tenantIdHeader), params.messageId);
  }

  @Post('operations/notifications/messages/:messageId/retry')
  @HttpCode(HttpStatus.OK)
  @Roles('admin', 'platform_admin', 'system', 'internal_operator')
  retryMessage(
    @Headers('x-tenant-id') tenantIdHeader: string | undefined,
    @Headers('x-idempotency-key') idempotencyKey: string | undefined,
    @Param(new ZodValidationPipe(messageIdParamsSchema)) params: MessageIdParamsDto,
  ) {
    requireIdempotencyKey(idempotencyKey);
    return this.service.retryMessage(tenantIdFromHeader(tenantIdHeader), params.messageId);
  }

  @Post('operations/notifications/messages/:messageId/cancel')
  @HttpCode(HttpStatus.OK)
  @Roles('admin', 'platform_admin', 'system', 'internal_operator')
  cancelMessage(
    @Headers('x-tenant-id') tenantIdHeader: string | undefined,
    @Headers('x-idempotency-key') idempotencyKey: string | undefined,
    @Param(new ZodValidationPipe(messageIdParamsSchema)) params: MessageIdParamsDto,
  ) {
    requireIdempotencyKey(idempotencyKey);
    return this.service.cancelMessage(tenantIdFromHeader(tenantIdHeader), params.messageId);
  }

  @Get('operations/notifications/templates')
  @Roles('internal_operator', 'risk_analyst', 'compliance_analyst', 'fraud_analyst', 'admin', 'platform_admin', 'system')
  listTemplates(
    @Headers('x-tenant-id') tenantIdHeader: string | undefined,
    @Query(new ZodValidationPipe(listTemplatesQuerySchema)) query: ListTemplatesQueryDto,
  ) {
    return this.service.listTemplates(tenantIdFromHeader(tenantIdHeader), query);
  }

  @Post('operations/notifications/templates')
  @HttpCode(HttpStatus.CREATED)
  @Roles('admin', 'platform_admin', 'system')
  createTemplate(
    @Headers('x-tenant-id') tenantIdHeader: string | undefined,
    @Headers('x-idempotency-key') idempotencyKey: string | undefined,
    @Body(new ZodValidationPipe(createTemplateSchema)) body: CreateTemplateDto,
  ) {
    requireIdempotencyKey(idempotencyKey);
    return this.service.createTemplate(tenantIdFromHeader(tenantIdHeader), body);
  }

  @Patch('operations/notifications/templates/:templateId')
  @Roles('admin', 'platform_admin', 'system')
  updateTemplate(
    @Headers('x-tenant-id') tenantIdHeader: string | undefined,
    @Headers('x-idempotency-key') idempotencyKey: string | undefined,
    @Param(new ZodValidationPipe(templateIdParamsSchema)) params: { templateId: string },
    @Body(new ZodValidationPipe(updateTemplateSchema)) body: UpdateTemplateDto,
  ) {
    requireIdempotencyKey(idempotencyKey);
    return this.service.updateTemplate(tenantIdFromHeader(tenantIdHeader), params.templateId, body);
  }

  @Get('operations/notifications/preferences/:customerId')
  @Roles('internal_operator', 'risk_analyst', 'compliance_analyst', 'fraud_analyst', 'admin', 'platform_admin', 'system')
  getPreferences(
    @Headers('x-tenant-id') tenantIdHeader: string | undefined,
    @Param(new ZodValidationPipe(preferencesParamsSchema)) params: PreferencesParamsDto,
  ) {
    return this.service.getPreferences(tenantIdFromHeader(tenantIdHeader), params.customerId);
  }

  @Patch('operations/notifications/preferences/:customerId')
  @Roles('admin', 'platform_admin', 'system', 'internal_operator')
  updatePreferences(
    @Headers('x-tenant-id') tenantIdHeader: string | undefined,
    @Headers('x-idempotency-key') idempotencyKey: string | undefined,
    @Param(new ZodValidationPipe(preferencesParamsSchema)) params: PreferencesParamsDto,
    @Body(new ZodValidationPipe(updatePreferencesSchema)) body: UpdatePreferencesDto,
  ) {
    requireIdempotencyKey(idempotencyKey);
    return this.service.updatePreferences(tenantIdFromHeader(tenantIdHeader), params.customerId, body);
  }

  @Get('customers/:customerId/notifications')
  @Roles('customer', 'internal_operator', 'admin', 'platform_admin', 'system')
  listCustomerNotifications(
    @Headers('x-tenant-id') tenantIdHeader: string | undefined,
    @Param(new ZodValidationPipe(customerNotificationsParamsSchema)) params: CustomerNotificationsParamsDto,
    @Query(new ZodValidationPipe(customerNotificationsQuerySchema)) query: CustomerNotificationsQueryDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    return this.service.listCustomerNotifications(tenantIdFromHeader(tenantIdHeader, currentUser), params.customerId, query, currentUser);
  }

  @Get('customers/:customerId/notifications/unread-count')
  @Roles('customer', 'internal_operator', 'admin', 'platform_admin', 'system')
  unreadCount(
    @Headers('x-tenant-id') tenantIdHeader: string | undefined,
    @Param(new ZodValidationPipe(customerNotificationsParamsSchema)) params: CustomerNotificationsParamsDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    return this.service.unreadCount(tenantIdFromHeader(tenantIdHeader, currentUser), params.customerId, currentUser);
  }

  @Post('customers/:customerId/notifications/:notificationId/read')
  @HttpCode(HttpStatus.OK)
  @Roles('customer', 'internal_operator', 'admin', 'platform_admin', 'system')
  markRead(
    @Headers('x-tenant-id') tenantIdHeader: string | undefined,
    @Param(new ZodValidationPipe(customerNotificationIdParamsSchema)) params: CustomerNotificationIdParamsDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    return this.service.markCustomerNotificationRead(
      tenantIdFromHeader(tenantIdHeader, currentUser),
      params.customerId,
      params.notificationId,
      currentUser,
    );
  }

  @Post('customers/:customerId/notifications/read-all')
  @HttpCode(HttpStatus.OK)
  @Roles('customer', 'internal_operator', 'admin', 'platform_admin', 'system')
  markAllRead(
    @Headers('x-tenant-id') tenantIdHeader: string | undefined,
    @Param(new ZodValidationPipe(customerNotificationsParamsSchema)) params: CustomerNotificationsParamsDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    return this.service.markAllCustomerNotificationsRead(tenantIdFromHeader(tenantIdHeader, currentUser), params.customerId, currentUser);
  }

  @Post('customers/:customerId/device-tokens')
  @HttpCode(HttpStatus.CREATED)
  @Roles('customer', 'internal_operator', 'admin', 'platform_admin', 'system')
  upsertDeviceToken(
    @Headers('x-tenant-id') tenantIdHeader: string | undefined,
    @Param(new ZodValidationPipe(customerNotificationsParamsSchema)) params: CustomerNotificationsParamsDto,
    @Body(new ZodValidationPipe(upsertDeviceTokenSchema)) body: UpsertDeviceTokenDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    return this.service.upsertDeviceToken(tenantIdFromHeader(tenantIdHeader, currentUser), params.customerId, body, currentUser);
  }

  @Delete('customers/:customerId/device-tokens/:deviceTokenId')
  @Roles('customer', 'internal_operator', 'admin', 'platform_admin', 'system')
  deactivateDeviceToken(
    @Headers('x-tenant-id') tenantIdHeader: string | undefined,
    @Param(new ZodValidationPipe(deviceTokenIdParamsSchema)) params: DeviceTokenIdParamsDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    return this.service.deactivateDeviceToken(
      tenantIdFromHeader(tenantIdHeader, currentUser),
      params.customerId,
      params.deviceTokenId,
      currentUser,
    );
  }
}
