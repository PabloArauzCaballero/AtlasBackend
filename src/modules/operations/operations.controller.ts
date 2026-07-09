import { BadRequestException, Body, Controller, Get, Headers, HttpCode, HttpStatus, Param, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiHeader, ApiOperation, ApiParam, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { zodObjectPropertySchemas, zodToApiSchema } from '../../common/openapi/zod-to-schema.util.js';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import { Roles } from '../../common/decorators/roles.decorator.js';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard.js';
import { RolesGuard } from '../../common/guards/roles.guard.js';
import { TenantGuard } from '../../common/guards/tenant.guard.js';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import { AuthenticatedUser } from '../../common/types/auth.types.js';
import { parsePositiveId } from '../../common/utils/ids/id.util.js';
import { FraudService } from '../fraud/fraud.service.js';
import { fraudDecisionParamsSchema, FraudDecisionParamsDto, fraudDecisionSchema, FraudDecisionDto } from '../fraud/fraud.schemas.js';
import { OperationsService } from './operations.service.js';
import {
  operationsCustomerIdParamsSchema,
  manualReviewDecisionParamsSchema,
  ManualReviewDecisionParamsDto,
  manualReviewDecisionSchema,
  ManualReviewDecisionDto,
  OperationsCustomerIdParamsDto,
  workQueueQuerySchema,
  WorkQueueQueryDto,
  cursorWorkQueueQuerySchema,
  CursorWorkQueueQueryDto,
} from './operations.schemas.js';

@ApiTags('operations')
@ApiBearerAuth('access-token')
@Controller('operations')
@UseGuards(JwtAuthGuard, TenantGuard, RolesGuard)
@Roles('internal_operator', 'risk_analyst', 'compliance_analyst', 'admin', 'platform_admin')
export class OperationsController {
  constructor(
    private readonly operationsService: OperationsService,
    private readonly fraudService: FraudService,
  ) {}

  @ApiOperation({ summary: 'Cola de trabajo combinada (revisión manual + fraude)', description: 'Vista paginada por OFFSET que combina ambas colas ordenadas por fecha. Para volúmenes altos, usar las variantes por cursor (manual-review-cases / fraud-cases).' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  @ApiQuery({ name: 'queue', required: false, schema: zodObjectPropertySchemas(workQueueQuerySchema).queue })
  @ApiQuery({ name: 'status', required: false, schema: zodObjectPropertySchemas(workQueueQuerySchema).status })
  @ApiQuery({ name: 'priority', required: false, schema: zodObjectPropertySchemas(workQueueQuerySchema).priority })
  @ApiResponse({ status: 200, description: 'Cola de trabajo paginada.' })
  @Get('work-queue')
  getWorkQueue(
    @Headers('x-tenant-id') tenantIdHeader: string | undefined,
    @Query(new ZodValidationPipe(workQueueQuerySchema)) query: WorkQueueQueryDto,
  ) {
    const tenantId = parsePositiveId(String(tenantIdHeader ?? ''), 'x-tenant-id');
    return this.operationsService.getWorkQueue(tenantId, query);
  }

  /**
   * ATLAS-P11-T10: endpoints por cursor de las colas individuales (no combinadas). Ver la nota
   * de alcance en `operations.repository.ts` sobre por qué `work-queue` (combinado) sigue OFFSET.
   */
  @ApiOperation({ summary: 'Cola de revisión manual (paginada por cursor)' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  @ApiQuery({ name: 'status', required: false, schema: zodObjectPropertySchemas(cursorWorkQueueQuerySchema).status })
  @ApiQuery({ name: 'cursor', required: false, schema: zodObjectPropertySchemas(cursorWorkQueueQuerySchema).cursor })
  @ApiResponse({ status: 200, description: 'Página de casos de revisión manual.' })
  @Get('manual-review-cases')
  getManualReviewCasesCursorPage(
    @Headers('x-tenant-id') tenantIdHeader: string | undefined,
    @Query(new ZodValidationPipe(cursorWorkQueueQuerySchema)) query: CursorWorkQueueQueryDto,
  ) {
    const tenantId = parsePositiveId(String(tenantIdHeader ?? ''), 'x-tenant-id');
    return this.operationsService.getManualReviewCasesCursorPage(tenantId, query);
  }

  @ApiOperation({ summary: 'Cola de casos de fraude (paginada por cursor)' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  @ApiQuery({ name: 'status', required: false, schema: zodObjectPropertySchemas(cursorWorkQueueQuerySchema).status })
  @ApiQuery({ name: 'cursor', required: false, schema: zodObjectPropertySchemas(cursorWorkQueueQuerySchema).cursor })
  @ApiResponse({ status: 200, description: 'Página de casos de fraude.' })
  @Get('fraud-cases')
  @Roles('fraud_analyst', 'internal_operator', 'risk_analyst', 'compliance_analyst', 'admin', 'platform_admin')
  getFraudCasesCursorPage(
    @Headers('x-tenant-id') tenantIdHeader: string | undefined,
    @Query(new ZodValidationPipe(cursorWorkQueueQuerySchema)) query: CursorWorkQueueQueryDto,
  ) {
    const tenantId = parsePositiveId(String(tenantIdHeader ?? ''), 'x-tenant-id');
    return this.operationsService.getFraudCasesCursorPage(tenantId, query);
  }

  @ApiOperation({ summary: 'Resumen de investigación de un cliente', description: 'Perfil, contactos, consentimientos, último resultado de riesgo (desglose completo) y casos abiertos, para investigación interna.' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  @ApiParam({ name: 'customerId', schema: zodToApiSchema(operationsCustomerIdParamsSchema.shape.customerId) })
  @ApiResponse({ status: 200, description: 'Resumen de investigación.' })
  @ApiResponse({ status: 404, description: 'Cliente no encontrado.' })
  @Get('customers/:customerId/investigation-summary')
  getInvestigationSummary(
    @Headers('x-tenant-id') tenantIdHeader: string | undefined,
    @Param(new ZodValidationPipe(operationsCustomerIdParamsSchema)) params: OperationsCustomerIdParamsDto,
  ) {
    const tenantId = parsePositiveId(String(tenantIdHeader ?? ''), 'x-tenant-id');
    return this.operationsService.getInvestigationSummary(tenantId, params);
  }

  @ApiOperation({
    summary: 'Decidir un caso de revisión manual',
    description: 'Registra la decisión (approved/rejected/request_more_information/escalated_to_fraud/no_action) y, si corresponde, actualiza el estado del cliente.',
  })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  @ApiHeader({ name: 'x-idempotency-key', required: true })
  @ApiParam({ name: 'caseId', schema: zodToApiSchema(manualReviewDecisionParamsSchema.shape.caseId) })
  @ApiBody({ schema: zodToApiSchema(manualReviewDecisionSchema) })
  @ApiResponse({ status: 200, description: 'Caso resuelto.' })
  @ApiResponse({ status: 404, description: 'CASE_NOT_FOUND.' })
  @ApiResponse({ status: 409, description: 'CASE_ALREADY_CLOSED.' })
  @ApiResponse({ status: 422, description: 'DECISION_REASON_REQUIRED — falta notas al rechazar/pedir más información.' })
  @Post('manual-review-cases/:caseId/decision')
  @HttpCode(HttpStatus.OK)
  @Roles('internal_operator', 'risk_analyst', 'admin', 'platform_admin')
  decideManualReviewCase(
    @Headers('x-tenant-id') tenantIdHeader: string | undefined,
    @Headers('x-idempotency-key') idempotencyKey: string | undefined,
    @Param(new ZodValidationPipe(manualReviewDecisionParamsSchema)) params: ManualReviewDecisionParamsDto,
    @Body(new ZodValidationPipe(manualReviewDecisionSchema)) body: ManualReviewDecisionDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    if (!idempotencyKey) throw new BadRequestException('X-Idempotency-Key header is required.');
    const tenantId = parsePositiveId(String(tenantIdHeader ?? ''), 'x-tenant-id');
    return this.operationsService.decideManualReviewCase({ tenantId, params, body, currentUser, idempotencyKey });
  }

  /**
   * ATLAS-AUDIT-014 (cerrado en este patch): la ruta se mantiene sin cambios por compatibilidad
   * de API; la implementación ahora vive en `FraudService` (módulo `fraud`), no en
   * `OperationsService`.
   */
  @ApiOperation({
    summary: 'Decidir un caso de fraude',
    description: 'Registra la decisión de un analista de fraude; puede aplicar watchlist (marca al cliente real por teléfono/email hasheado, no por customerId) y cambiar el estado del cliente. Exclusivo de fraud_analyst/admin/platform_admin.',
  })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  @ApiHeader({ name: 'x-idempotency-key', required: true })
  @ApiParam({ name: 'caseId', schema: zodToApiSchema(fraudDecisionParamsSchema.shape.caseId) })
  @ApiBody({ schema: zodToApiSchema(fraudDecisionSchema) })
  @ApiResponse({ status: 200, description: 'Caso resuelto.' })
  @ApiResponse({ status: 404, description: 'CASE_NOT_FOUND.' })
  @ApiResponse({ status: 409, description: 'CASE_ALREADY_CLOSED.' })
  @Post('fraud-cases/:caseId/decision')
  @HttpCode(HttpStatus.OK)
  @Roles('fraud_analyst', 'admin', 'platform_admin')
  decideFraudCase(
    @Headers('x-tenant-id') tenantIdHeader: string | undefined,
    @Headers('x-idempotency-key') idempotencyKey: string | undefined,
    @Param(new ZodValidationPipe(fraudDecisionParamsSchema)) params: FraudDecisionParamsDto,
    @Body(new ZodValidationPipe(fraudDecisionSchema)) body: FraudDecisionDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    if (!idempotencyKey) throw new BadRequestException('X-Idempotency-Key header is required.');
    const tenantId = parsePositiveId(String(tenantIdHeader ?? ''), 'x-tenant-id');
    return this.fraudService.decideFraudCase({ tenantId, params, body, currentUser, idempotencyKey });
  }
}
