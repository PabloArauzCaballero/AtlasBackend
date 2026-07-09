import { BadRequestException, Body, Controller, Headers, HttpCode, HttpStatus, Param, Post, Req, UseGuards } from '@nestjs/common';
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
import { CustomerPrivacyService } from './customer-privacy.service.js';
import {
  consentDecisionsSchema,
  ConsentDecisionsDto,
  dataSubjectRequestSchema,
  DataSubjectRequestDto,
  privacyCustomerParamsSchema,
  PrivacyCustomerParamsDto,
} from './customer-privacy.schemas.js';

type RequestWithIp = { ip?: string };

@ApiTags('customer-privacy')
@ApiBearerAuth('access-token')
@Controller('customers/:customerId/privacy')
@UseGuards(JwtAuthGuard, TenantGuard, RolesGuard)
@Roles('customer', 'internal_operator', 'compliance_analyst', 'admin', 'platform_admin')
export class CustomerPrivacyController {
  constructor(private readonly privacyService: CustomerPrivacyService) {}

  @ApiOperation({
    summary: 'Registrar decisiones de consentimiento (batch)',
    description:
      'Registra hasta 20 decisiones de consentimiento (otorgado/rechazado/revocado) en una sola llamada transaccional. Si alguna ' +
      'decisión es `revoked`, se crea automáticamente un evento de cambio de estado del cliente (`requires_review`). Cada ' +
      '`consentDocumentId` se valida contra el catálogo de documentos activos antes de escribir.',
  })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  @ApiHeader({ name: 'x-idempotency-key', required: true })
  @ApiHeader({ name: 'x-client-channel', required: false, description: 'Canal de origen (default: mobile_app).' })
  @ApiParam({ name: 'customerId', schema: zodToApiSchema(privacyCustomerParamsSchema.shape.customerId) })
  @ApiBody({ schema: zodToApiSchema(consentDecisionsSchema) })
  @ApiResponse({ status: 200, description: 'Decisiones procesadas — cantidad procesada y estado de consentimiento resultante.' })
  @ApiResponse({ status: 400, description: 'X-Idempotency-Key ausente.' })
  @ApiResponse({ status: 403, description: 'Un customer intentó operar sobre otro cliente.' })
  @ApiResponse({ status: 404, description: 'Cliente no encontrado.' })
  @ApiResponse({ status: 422, description: 'CONSENT_DOCUMENT_NOT_ACTIVE — algún consentDocumentId no está activo/vigente.' })
  @Post('consent-decisions')
  @HttpCode(HttpStatus.OK)
  registerConsentDecisions(
    @Headers('x-tenant-id') tenantIdHeader: string | undefined,
    @Headers('x-idempotency-key') idempotencyKey: string | undefined,
    @Headers('x-client-channel') channel: string | undefined,
    @Param(new ZodValidationPipe(privacyCustomerParamsSchema)) params: PrivacyCustomerParamsDto,
    @Body(new ZodValidationPipe(consentDecisionsSchema)) body: ConsentDecisionsDto,
    @CurrentUser() currentUser: AuthenticatedUser,
    @Req() request: RequestWithIp,
  ) {
    if (!idempotencyKey) throw new BadRequestException('X-Idempotency-Key header is required.');
    return this.privacyService.registerConsentDecisions({
      tenantId: parsePositiveId(String(tenantIdHeader ?? ''), 'x-tenant-id'),
      customerId: params.customerId,
      body,
      currentUser,
      idempotencyKey,
      ipAddress: request.ip ?? null,
      channel: channel ?? 'mobile_app',
    });
  }

  @ApiOperation({
    summary: 'Crear solicitud de derechos ARCO/GDPR',
    description:
      'Registra una solicitud de acceso/rectificación/cancelación/oposición (o portabilidad/restricción) sobre los datos del ' +
      'cliente. El plazo legal de resolución (`dueAt`) se fija en 15 días desde la recepción.',
  })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  @ApiHeader({ name: 'x-idempotency-key', required: true })
  @ApiParam({ name: 'customerId', schema: zodToApiSchema(privacyCustomerParamsSchema.shape.customerId) })
  @ApiBody({ schema: zodToApiSchema(dataSubjectRequestSchema) })
  @ApiResponse({ status: 201, description: 'Solicitud creada — estado "received", vence en 15 días.' })
  @ApiResponse({ status: 400, description: 'X-Idempotency-Key ausente.' })
  @ApiResponse({ status: 403, description: 'Un customer intentó operar sobre otro cliente.' })
  @ApiResponse({ status: 404, description: 'Cliente no encontrado.' })
  @Post('data-subject-requests')
  @HttpCode(HttpStatus.CREATED)
  createDataSubjectRequest(
    @Headers('x-tenant-id') tenantIdHeader: string | undefined,
    @Headers('x-idempotency-key') idempotencyKey: string | undefined,
    @Param(new ZodValidationPipe(privacyCustomerParamsSchema)) params: PrivacyCustomerParamsDto,
    @Body(new ZodValidationPipe(dataSubjectRequestSchema)) body: DataSubjectRequestDto,
    @CurrentUser() currentUser: AuthenticatedUser,
    @Req() request: RequestWithIp,
  ) {
    if (!idempotencyKey) throw new BadRequestException('X-Idempotency-Key header is required.');
    return this.privacyService.createDataSubjectRequest({
      tenantId: parsePositiveId(String(tenantIdHeader ?? ''), 'x-tenant-id'),
      customerId: params.customerId,
      body,
      currentUser,
      idempotencyKey,
      ipAddress: request.ip ?? null,
    });
  }
}
