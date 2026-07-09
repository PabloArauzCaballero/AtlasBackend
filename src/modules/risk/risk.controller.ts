import { BadRequestException, Body, Controller, Get, Headers, HttpCode, HttpStatus, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiHeader, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { zodToApiSchema } from '../../common/openapi/zod-to-schema.util.js';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import { Roles } from '../../common/decorators/roles.decorator.js';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard.js';
import { TenantGuard } from '../../common/guards/tenant.guard.js';
import { RolesGuard } from '../../common/guards/roles.guard.js';
import { AuthenticatedUser } from '../../common/types/auth.types.js';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import { parsePositiveId } from '../../common/utils/ids/id.util.js';
import { RiskService } from './risk.service.js';
import {
  createRiskAssessmentSchema,
  CreateRiskAssessmentDto,
  customerRiskParamsSchema,
  CustomerRiskParamsDto,
  riskAssessmentParamsSchema,
  RiskAssessmentParamsDto,
} from './risk.schemas.js';

@ApiTags('risk')
@ApiBearerAuth('access-token')
@Controller()
@UseGuards(JwtAuthGuard, TenantGuard, RolesGuard)
export class RiskController {
  constructor(private readonly riskService: RiskService) {}

  @Roles('customer', 'internal_operator', 'risk_analyst', 'system', 'admin', 'platform_admin')
  @ApiOperation({
    summary: 'Crear evaluación de riesgo',
    description:
      'Calcula un score de riesgo/fraude nuevo para el cliente (identidad, contacto, dispositivo, comportamiento) y registra la ' +
      'decisión resultante. Exige al menos un consentimiento vigente otorgado antes de ejecutar. Si faltan datos obligatorios ' +
      '(documento de identidad, contacto verificado), la decisión resultante es `manual_review_required` y se crea automáticamente ' +
      'el caso de revisión manual correspondiente.',
  })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  @ApiHeader({ name: 'x-idempotency-key', required: true })
  @ApiParam({ name: 'customerId', schema: zodToApiSchema(customerRiskParamsSchema.shape.customerId) })
  @ApiBody({ schema: zodToApiSchema(createRiskAssessmentSchema) })
  @ApiResponse({ status: 201, description: 'Evaluación creada — decisión, nivel de riesgo, y razones (sin desglose de scores internos).' })
  @ApiResponse({ status: 400, description: 'X-Idempotency-Key ausente, o x-tenant-id inválido.' })
  @ApiResponse({ status: 404, description: 'Cliente no encontrado.' })
  @ApiResponse({ status: 422, description: 'CUSTOMER_BLOCKED_FOR_RISK_ASSESSMENT o REQUIRED_CONSENT_MISSING.' })
  @Post('customers/:customerId/risk-assessments')
  @HttpCode(HttpStatus.CREATED)
  createRiskAssessment(
    @Headers('x-tenant-id') tenantIdHeader: string | undefined,
    @Headers('x-idempotency-key') idempotencyKey: string | undefined,
    @Param(new ZodValidationPipe(customerRiskParamsSchema)) params: CustomerRiskParamsDto,
    @Body(new ZodValidationPipe(createRiskAssessmentSchema)) body: CreateRiskAssessmentDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    if (!idempotencyKey) throw new BadRequestException('X-Idempotency-Key header is required.');
    return this.riskService.createRiskAssessment({
      tenantId: parsePositiveId(String(tenantIdHeader ?? ''), 'x-tenant-id'),
      customerId: params.customerId,
      body,
      currentUser,
      idempotencyKey,
    });
  }

  @Roles('internal_operator', 'risk_analyst', 'compliance_analyst', 'fraud_analyst', 'admin', 'platform_admin')
  @ApiOperation({
    summary: 'Detalle de una evaluación de riesgo (operaciones)',
    description:
      'Devuelve el desglose completo del modelo de riesgo (scores por dimensión, reason codes, versión de modelo/ruleset). ' +
      'Exclusivo de roles internos — nunca `customer`, para no exponer el detalle exacto del scoring al cliente evaluado.',
  })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  @ApiParam({ name: 'riskAssessmentRunId', schema: zodToApiSchema(riskAssessmentParamsSchema.shape.riskAssessmentRunId) })
  @ApiResponse({ status: 200, description: 'Detalle completo de la evaluación de riesgo.' })
  @ApiResponse({ status: 404, description: 'Evaluación no encontrada.' })
  @Get('operations/risk-assessments/:riskAssessmentRunId')
  getRiskAssessmentDetail(
    @Headers('x-tenant-id') tenantIdHeader: string | undefined,
    @Param(new ZodValidationPipe(riskAssessmentParamsSchema)) params: RiskAssessmentParamsDto,
  ) {
    return this.riskService.getRiskAssessmentDetail(
      parsePositiveId(String(tenantIdHeader ?? ''), 'x-tenant-id'),
      params.riskAssessmentRunId,
    );
  }

  @Roles('internal_operator', 'risk_analyst', 'compliance_analyst', 'fraud_analyst', 'admin', 'platform_admin')
  @ApiOperation({
    summary: 'Explicación de una evaluación de riesgo (operaciones)',
    description: 'Devuelve la explicación legible (reason codes traducidos, factores que más pesaron) de una evaluación de riesgo.',
  })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  @ApiParam({ name: 'riskAssessmentRunId', schema: zodToApiSchema(riskAssessmentParamsSchema.shape.riskAssessmentRunId) })
  @ApiResponse({ status: 200, description: 'Explicación de la evaluación de riesgo.' })
  @ApiResponse({ status: 404, description: 'Evaluación no encontrada.' })
  @Get('operations/risk-assessments/:riskAssessmentRunId/explanation')
  getRiskAssessmentExplanation(
    @Headers('x-tenant-id') tenantIdHeader: string | undefined,
    @Param(new ZodValidationPipe(riskAssessmentParamsSchema)) params: RiskAssessmentParamsDto,
  ) {
    return this.riskService.getRiskAssessmentExplanation(
      parsePositiveId(String(tenantIdHeader ?? ''), 'x-tenant-id'),
      params.riskAssessmentRunId,
    );
  }
}
