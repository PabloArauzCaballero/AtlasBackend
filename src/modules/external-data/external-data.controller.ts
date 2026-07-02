import {
  Body,
  Controller,
  ForbiddenException,
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
import { assertOwnCustomerResource } from '../../common/utils/auth/ownership.util.js';
import { parsePositiveId } from '../../common/utils/ids/id.util.js';
import { ExternalDataService } from './external-data.service.js';
import {
  approveProviderRequestSchema,
  ApproveProviderRequestDto,
  bankTransferVerifySchema,
  BankTransferVerifyDto,
  consentIdParamsSchema,
  ConsentIdParamsDto,
  customerIdParamsSchema,
  CustomerIdParamsDto,
  decisionPackageQuerySchema,
  DecisionPackageQueryDto,
  digitalTrustCheckSchema,
  DigitalTrustCheckDto,
  externalConsentSchema,
  ExternalConsentDto,
  externalDataRequestSchema,
  ExternalDataRequestDto,
  facebookCallbackSchema,
  FacebookCallbackDto,
  facebookConnectUrlQuerySchema,
  FacebookConnectUrlQueryDto,
  infocenterCheckSchema,
  InfocenterCheckDto,
  idempotencyAuditQuerySchema,
  IdempotencyAuditQueryDto,
  productionGateQuerySchema,
  ProductionGateQueryDto,
  providerCodeParamsSchema,
  ProviderCodeParamsDto,
  providerSlaQuerySchema,
  ProviderSlaQueryDto,
  providerRuntimePatchSchema,
  ProviderRuntimePatchDto,
  providerUsageQuerySchema,
  ProviderUsageQueryDto,
  providerCostPolicyPatchSchema,
  ProviderCostPolicyPatchDto,
  qrPaymentVerifySchema,
  QrPaymentVerifyDto,
  requestIdParamsSchema,
  RequestIdParamsDto,
  retentionPreviewQuerySchema,
  RetentionPreviewQueryDto,
  retryRequestSchema,
  RetryRequestDto,
  sanitizationAuditQuerySchema,
  SanitizationAuditQueryDto,
  segipVerifySchema,
  SegipVerifyDto,
  telcoPhoneTrustSchema,
  TelcoPhoneTrustDto,
  whatsappVerificationConfirmSchema,
  WhatsappVerificationConfirmDto,
  whatsappVerificationStartSchema,
  WhatsappVerificationStartDto,
} from './external-data.schemas.js';

function tenantIdFromHeader(header: string | undefined, currentUser?: AuthenticatedUser): string {
  return parsePositiveId(String(header ?? currentUser?.tenantId ?? ''), 'x-tenant-id');
}

function actorId(currentUser: AuthenticatedUser): string | undefined {
  return currentUser.internalUserId ?? currentUser.platformUserId ?? currentUser.customerId;
}

function assertCustomerAccess(currentUser: AuthenticatedUser, customerId?: string): void {
  if (customerId) assertOwnCustomerResource(currentUser, customerId);
}

function customerScopeForConsentMutation(currentUser: AuthenticatedUser): string | undefined {
  if (currentUser.role !== 'customer') return undefined;
  if (!currentUser.customerId) throw new ForbiddenException('El token de cliente no contiene customerId.');
  return currentUser.customerId;
}

@ApiTags('external-data')
@Controller('external-data')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('customer', 'internal_operator', 'risk_analyst', 'compliance_analyst', 'fraud_analyst', 'admin', 'platform_admin', 'system')
export class ExternalDataController {
  constructor(private readonly externalDataService: ExternalDataService) {}

  @Post('consents')
  @HttpCode(HttpStatus.CREATED)
  createConsent(
    @Headers('x-tenant-id') tenantIdHeader: string | undefined,
    @Headers('x-forwarded-for') ipAddress: string | undefined,
    @Headers('user-agent') userAgent: string | undefined,
    @Body(new ZodValidationPipe(externalConsentSchema)) body: ExternalConsentDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    assertCustomerAccess(currentUser, body.customerId);
    return this.externalDataService.createConsent({
      tenantId: tenantIdFromHeader(tenantIdHeader, currentUser),
      body,
      ipAddress,
      userAgent,
    });
  }

  @Get('consents/user/:customerId')
  listConsents(
    @Headers('x-tenant-id') tenantIdHeader: string | undefined,
    @Param(new ZodValidationPipe(customerIdParamsSchema)) params: CustomerIdParamsDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    assertCustomerAccess(currentUser, params.customerId);
    return this.externalDataService.listCustomerConsents({
      tenantId: tenantIdFromHeader(tenantIdHeader, currentUser),
      customerId: params.customerId,
    });
  }

  @Post('consents/:consentId/revoke')
  @HttpCode(HttpStatus.OK)
  revokeConsent(
    @Headers('x-tenant-id') tenantIdHeader: string | undefined,
    @Param(new ZodValidationPipe(consentIdParamsSchema)) params: ConsentIdParamsDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    return this.externalDataService.revokeConsent({
      tenantId: tenantIdFromHeader(tenantIdHeader, currentUser),
      consentId: params.consentId,
      customerId: customerScopeForConsentMutation(currentUser),
    });
  }

  @Post('requests/preview')
  @HttpCode(HttpStatus.OK)
  previewRequest(
    @Headers('x-tenant-id') tenantIdHeader: string | undefined,
    @Body(new ZodValidationPipe(externalDataRequestSchema)) body: ExternalDataRequestDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    assertCustomerAccess(currentUser, body.customerId);
    return this.externalDataService.previewExternalDataRequest({
      tenantId: tenantIdFromHeader(tenantIdHeader, currentUser),
      body,
      requestedByUserId: actorId(currentUser),
    });
  }

  @Post('requests')
  @HttpCode(HttpStatus.OK)
  executeRequest(
    @Headers('x-tenant-id') tenantIdHeader: string | undefined,
    @Headers('x-idempotency-key') idempotencyKey: string | undefined,
    @Body(new ZodValidationPipe(externalDataRequestSchema)) body: ExternalDataRequestDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    assertCustomerAccess(currentUser, body.customerId);
    return this.externalDataService.executeExternalDataRequest({
      tenantId: tenantIdFromHeader(tenantIdHeader, currentUser),
      body,
      idempotencyKey,
      requestedByUserId: actorId(currentUser),
    });
  }

  @Get('requests/:requestId')
  getRequest(
    @Headers('x-tenant-id') tenantIdHeader: string | undefined,
    @Param(new ZodValidationPipe(requestIdParamsSchema)) params: RequestIdParamsDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    return this.externalDataService.getProviderRequest({
      tenantId: tenantIdFromHeader(tenantIdHeader, currentUser),
      requestId: params.requestId,
    });
  }

  @Get('providers/health')
  getProviderHealth(@Query('providerCode') providerCode?: string) {
    return this.externalDataService.getProviderHealth(providerCode);
  }

  @Get('users/:customerId/features')
  getUserFeatures(
    @Headers('x-tenant-id') tenantIdHeader: string | undefined,
    @Param(new ZodValidationPipe(customerIdParamsSchema)) params: CustomerIdParamsDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    assertCustomerAccess(currentUser, params.customerId);
    return this.externalDataService.getCustomerFeatures({
      tenantId: tenantIdFromHeader(tenantIdHeader, currentUser),
      customerId: params.customerId,
    });
  }

  @Get('users/:customerId/scoring-input')
  getUserScoringInput(
    @Headers('x-tenant-id') tenantIdHeader: string | undefined,
    @Param(new ZodValidationPipe(customerIdParamsSchema)) params: CustomerIdParamsDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    assertCustomerAccess(currentUser, params.customerId);
    return this.externalDataService.getCustomerScoringInput({
      tenantId: tenantIdFromHeader(tenantIdHeader, currentUser),
      customerId: params.customerId,
    });
  }

  @Get('users/:customerId/decision-package')
  getDecisionPackage(
    @Headers('x-tenant-id') tenantIdHeader: string | undefined,
    @Param(new ZodValidationPipe(customerIdParamsSchema)) params: CustomerIdParamsDto,
    @Query(new ZodValidationPipe(decisionPackageQuerySchema)) query: DecisionPackageQueryDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    assertCustomerAccess(currentUser, params.customerId);
    return this.externalDataService.getCustomerDecisionPackage({
      tenantId: tenantIdFromHeader(tenantIdHeader, currentUser),
      customerId: params.customerId,
      includeRawResponses: query.includeRawResponses,
      featureMaxAgeHours: query.featureMaxAgeHours,
    });
  }

  @Get('users/:customerId/observations')
  getUserObservations(
    @Headers('x-tenant-id') tenantIdHeader: string | undefined,
    @Param(new ZodValidationPipe(customerIdParamsSchema)) params: CustomerIdParamsDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    assertCustomerAccess(currentUser, params.customerId);
    return this.externalDataService.getCustomerObservations({
      tenantId: tenantIdFromHeader(tenantIdHeader, currentUser),
      customerId: params.customerId,
    });
  }
}

@ApiTags('external-data-admin')
@Controller('admin/external-providers')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin', 'platform_admin', 'risk_analyst', 'compliance_analyst')
export class AdminExternalProvidersController {
  constructor(private readonly externalDataService: ExternalDataService) {}

  @Get()
  listProviders() {
    return this.externalDataService.listProviders();
  }

  @Get('health')
  health() {
    return this.externalDataService.getProviderHealth();
  }

  @Get('readiness')
  readiness() {
    return this.externalDataService.getProviderReadiness();
  }

  @Get('quality-audit')
  qualityAudit() {
    return this.externalDataService.auditExternalProvidersQuality();
  }

  @Get('production-gate')
  productionGate(@Query(new ZodValidationPipe(productionGateQuerySchema)) query: ProductionGateQueryDto) {
    return this.externalDataService.getProductionGate({ providerCode: query.providerCode, strict: query.strict });
  }

  @Get('sla')
  sla(
    @Headers('x-tenant-id') tenantIdHeader: string | undefined,
    @Query(new ZodValidationPipe(providerSlaQuerySchema)) query: ProviderSlaQueryDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    return this.externalDataService.getProviderSlaReport({
      tenantId: tenantIdFromHeader(tenantIdHeader, currentUser),
      providerCode: query.providerCode,
      days: query.days,
    });
  }

  @Get('usage')
  usage(
    @Headers('x-tenant-id') tenantIdHeader: string | undefined,
    @Query(new ZodValidationPipe(providerUsageQuerySchema)) query: ProviderUsageQueryDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    return this.externalDataService.getProviderUsage({
      tenantId: tenantIdFromHeader(tenantIdHeader, currentUser),
      providerCode: query.providerCode,
      days: query.days,
    });
  }

  @Get('idempotency-audit')
  idempotencyAudit(
    @Headers('x-tenant-id') tenantIdHeader: string | undefined,
    @Query(new ZodValidationPipe(idempotencyAuditQuerySchema)) query: IdempotencyAuditQueryDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    return this.externalDataService.auditIdempotencyKeys({
      tenantId: tenantIdFromHeader(tenantIdHeader, currentUser),
      days: query.days,
      limit: query.limit,
    });
  }

  @Get('retention/preview')
  retentionPreview(@Query(new ZodValidationPipe(retentionPreviewQuerySchema)) query: RetentionPreviewQueryDto) {
    return this.externalDataService.getRetentionPreview({ days: query.days, limit: query.limit });
  }

  @Get('sanitization-audit')
  sanitizationAudit(@Query(new ZodValidationPipe(sanitizationAuditQuerySchema)) query: SanitizationAuditQueryDto) {
    return this.externalDataService.auditResponseSanitization({ limit: query.limit });
  }

  @Post('policy/preview')
  @HttpCode(HttpStatus.OK)
  previewPolicy(
    @Headers('x-tenant-id') tenantIdHeader: string | undefined,
    @Body(new ZodValidationPipe(externalDataRequestSchema)) body: ExternalDataRequestDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    assertCustomerAccess(currentUser, body.customerId);
    return this.externalDataService.previewExternalDataRequest({
      tenantId: tenantIdFromHeader(tenantIdHeader, currentUser),
      body,
      requestedByUserId: actorId(currentUser),
    });
  }

  @Patch(':providerCode/runtime')
  patchRuntime(
    @Param(new ZodValidationPipe(providerCodeParamsSchema)) params: ProviderCodeParamsDto,
    @Body(new ZodValidationPipe(providerRuntimePatchSchema)) body: ProviderRuntimePatchDto,
  ) {
    return this.externalDataService.updateProviderRuntimePolicy({ providerCode: params.providerCode, patch: body });
  }

  @Post(':providerCode/kill-switch')
  @HttpCode(HttpStatus.OK)
  killSwitch(
    @Param(new ZodValidationPipe(providerCodeParamsSchema)) params: ProviderCodeParamsDto,
    @Body(new ZodValidationPipe(providerRuntimePatchSchema)) body: ProviderRuntimePatchDto,
  ) {
    return this.externalDataService.activateProviderKillSwitch({ providerCode: params.providerCode, reason: body.reason });
  }

  @Get(':providerCode/cost-policy')
  getCostPolicy(@Param(new ZodValidationPipe(providerCodeParamsSchema)) params: ProviderCodeParamsDto) {
    return this.externalDataService.getProviderCostPolicies(params.providerCode);
  }

  @Patch(':providerCode/cost-policy/:queryType')
  updateCostPolicy(
    @Param(new ZodValidationPipe(providerCodeParamsSchema)) params: ProviderCodeParamsDto,
    @Param('queryType') queryType: string,
    @Body(new ZodValidationPipe(providerCostPolicyPatchSchema)) body: ProviderCostPolicyPatchDto,
  ) {
    return this.externalDataService.updateProviderCostPolicy({ providerCode: params.providerCode, queryType, patch: body });
  }

  @Post(':providerCode/test')
  @HttpCode(HttpStatus.OK)
  testProvider(
    @Headers('x-tenant-id') tenantIdHeader: string | undefined,
    @Param(new ZodValidationPipe(providerCodeParamsSchema)) params: ProviderCodeParamsDto,
    @Body() body: Record<string, unknown> = {},
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    return this.externalDataService.executeExternalDataRequest({
      tenantId: tenantIdFromHeader(tenantIdHeader, currentUser),
      body: {
        providerCode: params.providerCode,
        customerId: typeof body.customerId === 'string' ? body.customerId : '1',
        queryType: typeof body.queryType === 'string' ? body.queryType : 'IDENTITY_VERIFICATION',
        purpose: typeof body.purpose === 'string' ? body.purpose : 'MANUAL_REVIEW',
        decisionStage: typeof body.decisionStage === 'string' ? body.decisionStage : 'MANUAL_REVIEW',
        input: typeof body.input === 'object' && body.input !== null ? (body.input as Record<string, unknown>) : {},
        scenario: typeof body.scenario === 'string' ? body.scenario : undefined,
        approvedByAdminId: actorId(currentUser),
      },
      requestedByUserId: actorId(currentUser),
    });
  }

  @Post('requests/:requestId/approve')
  @HttpCode(HttpStatus.OK)
  approveRequest(
    @Headers('x-tenant-id') tenantIdHeader: string | undefined,
    @Param(new ZodValidationPipe(requestIdParamsSchema)) params: RequestIdParamsDto,
    @Body(new ZodValidationPipe(approveProviderRequestSchema)) body: ApproveProviderRequestDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    return this.externalDataService.approveRequest({
      tenantId: tenantIdFromHeader(tenantIdHeader, currentUser),
      requestId: params.requestId,
      approvedByAdminId: body.approvedByAdminId ?? actorId(currentUser),
      approvalReason: body.approvalReason,
    });
  }

  @Post('requests/:requestId/retry')
  @HttpCode(HttpStatus.OK)
  retryRequest(
    @Headers('x-tenant-id') tenantIdHeader: string | undefined,
    @Param(new ZodValidationPipe(requestIdParamsSchema)) params: RequestIdParamsDto,
    @Body(new ZodValidationPipe(retryRequestSchema)) body: RetryRequestDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    return this.externalDataService.retryProviderRequest({
      tenantId: tenantIdFromHeader(tenantIdHeader, currentUser),
      requestId: params.requestId,
      body,
      requestedByUserId: actorId(currentUser),
    });
  }

  @Post('requests/:requestId/rebuild-features')
  @HttpCode(HttpStatus.OK)
  rebuildFeatures(
    @Headers('x-tenant-id') tenantIdHeader: string | undefined,
    @Param(new ZodValidationPipe(requestIdParamsSchema)) params: RequestIdParamsDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    return this.externalDataService.rebuildFeatureSnapshotFromRequest({
      tenantId: tenantIdFromHeader(tenantIdHeader, currentUser),
      requestId: params.requestId,
    });
  }
}

@ApiTags('kyc')
@Controller('kyc')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('customer', 'internal_operator', 'risk_analyst', 'compliance_analyst', 'fraud_analyst', 'admin', 'platform_admin', 'system')
export class KycExternalDataController {
  constructor(private readonly externalDataService: ExternalDataService) {}

  @Post('segip/verify')
  @HttpCode(HttpStatus.OK)
  verifySegip(
    @Headers('x-tenant-id') tenantIdHeader: string | undefined,
    @Headers('x-idempotency-key') idempotencyKey: string | undefined,
    @Body(new ZodValidationPipe(segipVerifySchema)) body: SegipVerifyDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    assertCustomerAccess(currentUser, body.customerId);
    return this.externalDataService.executeSegip({
      tenantId: tenantIdFromHeader(tenantIdHeader, currentUser),
      customerId: body.customerId,
      body,
      idempotencyKey,
      requestedByUserId: actorId(currentUser),
    });
  }
}

@ApiTags('bureau')
@Controller('bureau')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin', 'platform_admin', 'risk_analyst', 'compliance_analyst')
export class BureauExternalDataController {
  constructor(private readonly externalDataService: ExternalDataService) {}

  @Post('infocenter/check')
  @HttpCode(HttpStatus.OK)
  checkInfocenter(
    @Headers('x-tenant-id') tenantIdHeader: string | undefined,
    @Headers('x-idempotency-key') idempotencyKey: string | undefined,
    @Body(new ZodValidationPipe(infocenterCheckSchema)) body: InfocenterCheckDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    assertCustomerAccess(currentUser, body.customerId);
    return this.externalDataService.executeInfocenter({
      tenantId: tenantIdFromHeader(tenantIdHeader, currentUser),
      customerId: body.customerId,
      body,
      idempotencyKey,
      requestedByUserId: actorId(currentUser),
    });
  }
}

@ApiTags('payments-external')
@Controller('payments')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('customer', 'internal_operator', 'risk_analyst', 'admin', 'platform_admin', 'system')
export class PaymentsExternalDataController {
  constructor(private readonly externalDataService: ExternalDataService) {}

  @Post('qr/verify')
  @HttpCode(HttpStatus.OK)
  verifyQr(
    @Headers('x-tenant-id') tenantIdHeader: string | undefined,
    @Headers('x-idempotency-key') idempotencyKey: string | undefined,
    @Body(new ZodValidationPipe(qrPaymentVerifySchema)) body: QrPaymentVerifyDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    assertCustomerAccess(currentUser, body.customerId);
    return this.externalDataService.executeQrPayment({
      tenantId: tenantIdFromHeader(tenantIdHeader, currentUser),
      customerId: body.customerId,
      body,
      idempotencyKey,
      requestedByUserId: actorId(currentUser),
    });
  }

  @Post('bank-transfer/verify')
  @HttpCode(HttpStatus.OK)
  verifyBankTransfer(
    @Headers('x-tenant-id') tenantIdHeader: string | undefined,
    @Headers('x-idempotency-key') idempotencyKey: string | undefined,
    @Body(new ZodValidationPipe(bankTransferVerifySchema)) body: BankTransferVerifyDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    assertCustomerAccess(currentUser, body.customerId);
    return this.externalDataService.executeBankTransfer({
      tenantId: tenantIdFromHeader(tenantIdHeader, currentUser),
      customerId: body.customerId,
      body,
      idempotencyKey,
      requestedByUserId: actorId(currentUser),
    });
  }
}

@ApiTags('telco')
@Controller('telco')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('customer', 'internal_operator', 'risk_analyst', 'fraud_analyst', 'admin', 'platform_admin', 'system')
export class TelcoExternalDataController {
  constructor(private readonly externalDataService: ExternalDataService) {}

  @Post('phone-trust/verify')
  @HttpCode(HttpStatus.OK)
  verifyPhoneTrust(
    @Headers('x-tenant-id') tenantIdHeader: string | undefined,
    @Headers('x-idempotency-key') idempotencyKey: string | undefined,
    @Body(new ZodValidationPipe(telcoPhoneTrustSchema)) body: TelcoPhoneTrustDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    assertCustomerAccess(currentUser, body.customerId);
    return this.externalDataService.executeTelcoPhoneTrust({
      tenantId: tenantIdFromHeader(tenantIdHeader, currentUser),
      customerId: body.customerId,
      body,
      idempotencyKey,
      requestedByUserId: actorId(currentUser),
    });
  }

  @Get('phone-trust/:customerId')
  getPhoneTrust(
    @Headers('x-tenant-id') tenantIdHeader: string | undefined,
    @Param(new ZodValidationPipe(customerIdParamsSchema)) params: CustomerIdParamsDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    assertCustomerAccess(currentUser, params.customerId);
    return this.externalDataService.getCustomerFeatures({
      tenantId: tenantIdFromHeader(tenantIdHeader, currentUser),
      customerId: params.customerId,
    });
  }
}

@ApiTags('social')
@Controller('social/facebook')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('customer', 'internal_operator', 'risk_analyst', 'admin', 'platform_admin', 'system')
export class FacebookExternalDataController {
  constructor(private readonly externalDataService: ExternalDataService) {}

  @Get('connect-url')
  getConnectUrl(
    @Headers('x-tenant-id') tenantIdHeader: string | undefined,
    @Query(new ZodValidationPipe(facebookConnectUrlQuerySchema)) query: FacebookConnectUrlQueryDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    assertCustomerAccess(currentUser, query.customerId);
    return this.externalDataService.createFacebookConnectUrl({
      tenantId: tenantIdFromHeader(tenantIdHeader, currentUser),
      customerId: query.customerId,
    });
  }

  @Post('callback')
  @HttpCode(HttpStatus.OK)
  callback(
    @Headers('x-tenant-id') tenantIdHeader: string | undefined,
    @Headers('x-idempotency-key') idempotencyKey: string | undefined,
    @Body(new ZodValidationPipe(facebookCallbackSchema)) body: FacebookCallbackDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    assertCustomerAccess(currentUser, body.customerId);
    return this.externalDataService.executeFacebookCallback({
      tenantId: tenantIdFromHeader(tenantIdHeader, currentUser),
      customerId: body.customerId,
      body,
      idempotencyKey,
      requestedByUserId: actorId(currentUser),
    });
  }

  @Get('status/:customerId')
  status(
    @Headers('x-tenant-id') tenantIdHeader: string | undefined,
    @Param(new ZodValidationPipe(customerIdParamsSchema)) params: CustomerIdParamsDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    assertCustomerAccess(currentUser, params.customerId);
    return this.externalDataService.getCustomerFeatures({
      tenantId: tenantIdFromHeader(tenantIdHeader, currentUser),
      customerId: params.customerId,
    });
  }
}

@ApiTags('whatsapp')
@Controller('whatsapp')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('customer', 'internal_operator', 'risk_analyst', 'admin', 'platform_admin', 'system')
export class WhatsappExternalDataController {
  constructor(private readonly externalDataService: ExternalDataService) {}

  @Post('verification/start')
  @HttpCode(HttpStatus.OK)
  start(
    @Headers('x-tenant-id') tenantIdHeader: string | undefined,
    @Headers('x-idempotency-key') idempotencyKey: string | undefined,
    @Body(new ZodValidationPipe(whatsappVerificationStartSchema)) body: WhatsappVerificationStartDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    assertCustomerAccess(currentUser, body.customerId);
    return this.externalDataService.executeWhatsapp({
      tenantId: tenantIdFromHeader(tenantIdHeader, currentUser),
      customerId: body.customerId,
      body,
      idempotencyKey,
      requestedByUserId: actorId(currentUser),
    });
  }

  @Post('verification/confirm')
  @HttpCode(HttpStatus.OK)
  confirm(
    @Headers('x-tenant-id') tenantIdHeader: string | undefined,
    @Headers('x-idempotency-key') idempotencyKey: string | undefined,
    @Body(new ZodValidationPipe(whatsappVerificationConfirmSchema)) body: WhatsappVerificationConfirmDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    assertCustomerAccess(currentUser, body.customerId);
    return this.externalDataService.executeWhatsapp({
      tenantId: tenantIdFromHeader(tenantIdHeader, currentUser),
      customerId: body.customerId,
      body,
      idempotencyKey,
      requestedByUserId: actorId(currentUser),
    });
  }

  @Get('status/:customerId')
  status(
    @Headers('x-tenant-id') tenantIdHeader: string | undefined,
    @Param(new ZodValidationPipe(customerIdParamsSchema)) params: CustomerIdParamsDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    assertCustomerAccess(currentUser, params.customerId);
    return this.externalDataService.getCustomerFeatures({
      tenantId: tenantIdFromHeader(tenantIdHeader, currentUser),
      customerId: params.customerId,
    });
  }
}

@ApiTags('digital-trust')
@Controller('digital-trust')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('customer', 'internal_operator', 'risk_analyst', 'fraud_analyst', 'admin', 'platform_admin', 'system')
export class DigitalTrustExternalDataController {
  constructor(private readonly externalDataService: ExternalDataService) {}

  @Post('check')
  @HttpCode(HttpStatus.OK)
  check(
    @Headers('x-tenant-id') tenantIdHeader: string | undefined,
    @Headers('x-idempotency-key') idempotencyKey: string | undefined,
    @Body(new ZodValidationPipe(digitalTrustCheckSchema)) body: DigitalTrustCheckDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    assertCustomerAccess(currentUser, body.customerId);
    return this.externalDataService.executeDigitalTrust({
      tenantId: tenantIdFromHeader(tenantIdHeader, currentUser),
      customerId: body.customerId,
      body,
      idempotencyKey,
      requestedByUserId: actorId(currentUser),
    });
  }

  @Get('profile/:customerId')
  profile(
    @Headers('x-tenant-id') tenantIdHeader: string | undefined,
    @Param(new ZodValidationPipe(customerIdParamsSchema)) params: CustomerIdParamsDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    assertCustomerAccess(currentUser, params.customerId);
    return this.externalDataService.getCustomerFeatures({
      tenantId: tenantIdFromHeader(tenantIdHeader, currentUser),
      customerId: params.customerId,
    });
  }
}
