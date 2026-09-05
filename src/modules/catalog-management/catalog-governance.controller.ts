/**
 * @file Adaptador HTTP: valida y autoriza la petición antes de delegar el caso de uso.
 * @business Esta pieza gobierna las reglas de riesgo vigentes y las políticas de tratamiento de datos.
 * @system expone la consulta y activación de rulesets de riesgo y la publicación de políticas de gobierno.
 */
import { Body, Controller, Get, Headers, HttpCode, HttpStatus, Param, Post, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiHeader, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { zodToApiSchema } from '../../common/openapi/zod-to-schema.util.js';
import { CurrentTenant } from '../../common/decorators/current-tenant.decorator.js';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import { Roles } from '../../common/decorators/roles.decorator.js';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard.js';
import { RolesGuard } from '../../common/guards/roles.guard.js';
import { TenantGuard } from '../../common/guards/tenant.guard.js';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import { AuthenticatedUser } from '../../common/types/auth.types.js';
import { RequestWithNetwork, requireIdempotencyKey } from '../../common/utils/http/headers.util.js';
import { contextFrom } from './catalog-request-context.util.js';
import { CatalogManagementService } from './catalog-management.service.js';
import {
  ActivateRiskRulesetVersionDto,
  CreateRiskRulesetVersionDto,
  DataGovernancePolicyPackageDto,
  RulesetVersionParamsDto,
  activateRiskRulesetVersionSchema,
  createRiskRulesetVersionSchema,
  dataGovernancePolicyPackageSchema,
  rulesetVersionParamsSchema,
} from './catalog-management.schemas.js';

/**
 * Gobierno de las reglas de riesgo y de las políticas de datos.
 *
 * Salió de `CatalogManagementController` porque no es lo mismo: un catálogo es un dato de referencia
 * versionado, mientras que activar un ruleset de riesgo o publicar un paquete de políticas de
 * tratamiento son actos de GOBIERNO, con doble control y rastro propio. Compartían archivo por
 * vecindad de módulo, no por parecido.
 *
 * Las rutas no cambian: siguen colgando de `operations/` para no romper a ningún consumidor.
 */
@ApiTags('catalog-management')
@ApiBearerAuth('access-token')
@Controller('operations')
@UseGuards(JwtAuthGuard, TenantGuard, RolesGuard)
export class CatalogGovernanceController {
  constructor(private readonly service: CatalogManagementService) {}

  @ApiOperation({ summary: 'Obtener la política de riesgo activa' })
  @ApiResponse({ status: 200, description: 'Política de riesgo actual (ruleset activo).' })
  @Get('risk-policy/current')
  getCurrentRiskPolicy(@CurrentUser() currentUser: AuthenticatedUser) {
    return this.service.getCurrentRiskPolicy({ currentUser });
  }

  @ApiOperation({ summary: 'Crear una nueva versión de ruleset de riesgo (borrador)' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  @ApiHeader({ name: 'x-idempotency-key', required: true })
  @ApiBody({ schema: zodToApiSchema(createRiskRulesetVersionSchema) })
  @ApiResponse({ status: 201, description: 'Versión de ruleset creada.' })
  @Post('risk-policy/ruleset-versions')
  @HttpCode(HttpStatus.CREATED)
  createRiskRulesetVersion(
    @CurrentTenant() tenantId: string,
    @Headers('x-idempotency-key') idempotencyKey: string | undefined,
    @Body(new ZodValidationPipe(createRiskRulesetVersionSchema)) body: CreateRiskRulesetVersionDto,
    @CurrentUser() currentUser: AuthenticatedUser,
    @Req() request: RequestWithNetwork,
  ) {
    requireIdempotencyKey(idempotencyKey);
    return this.service.createRiskRulesetVersion({ body, currentUser, context: contextFrom(tenantId, idempotencyKey, request) });
  }

  @ApiOperation({ summary: 'Activar una versión de ruleset de riesgo' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  @ApiHeader({ name: 'x-idempotency-key', required: true })
  @ApiParam({ name: 'rulesetVersionId', schema: zodToApiSchema(rulesetVersionParamsSchema.shape.rulesetVersionId) })
  @ApiBody({ schema: zodToApiSchema(activateRiskRulesetVersionSchema) })
  @ApiResponse({ status: 200, description: 'Versión de ruleset activada.' })
  @ApiResponse({ status: 404, description: 'RULESET_VERSION_NOT_FOUND.' })
  @Post('risk-policy/ruleset-versions/:rulesetVersionId/activate')
  @HttpCode(HttpStatus.OK)
  @Roles('admin', 'platform_admin')
  activateRiskRulesetVersion(
    @CurrentTenant() tenantId: string,
    @Headers('x-idempotency-key') idempotencyKey: string | undefined,
    @Param(new ZodValidationPipe(rulesetVersionParamsSchema)) params: RulesetVersionParamsDto,
    @Body(new ZodValidationPipe(activateRiskRulesetVersionSchema)) body: ActivateRiskRulesetVersionDto,
    @CurrentUser() currentUser: AuthenticatedUser,
    @Req() request: RequestWithNetwork,
  ) {
    requireIdempotencyKey(idempotencyKey);
    return this.service.activateRiskRulesetVersion({
      rulesetVersionId: params.rulesetVersionId,
      body,
      currentUser,
      context: contextFrom(tenantId, idempotencyKey, request),
    });
  }

  @ApiOperation({ summary: 'Obtener las políticas de gobernanza de datos activas' })
  @ApiResponse({ status: 200, description: 'Políticas de gobernanza (propósitos, clasificaciones, retenciones).' })
  @Get('data-governance/policies')
  getDataGovernancePolicies(@CurrentUser() currentUser: AuthenticatedUser) {
    return this.service.getDataGovernancePolicies({ currentUser });
  }

  @ApiOperation({ summary: 'Publicar un paquete de políticas de gobernanza de datos' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  @ApiHeader({ name: 'x-idempotency-key', required: true })
  @ApiBody({ schema: zodToApiSchema(dataGovernancePolicyPackageSchema) })
  @ApiResponse({ status: 200, description: 'Paquete de gobernanza de datos aplicado.' })
  @Post('data-governance/policy-package')
  @HttpCode(HttpStatus.OK)
  upsertDataGovernancePackage(
    @CurrentTenant() tenantId: string,
    @Headers('x-idempotency-key') idempotencyKey: string | undefined,
    @Body(new ZodValidationPipe(dataGovernancePolicyPackageSchema)) body: DataGovernancePolicyPackageDto,
    @CurrentUser() currentUser: AuthenticatedUser,
    @Req() request: RequestWithNetwork,
  ) {
    requireIdempotencyKey(idempotencyKey);
    return this.service.upsertDataGovernancePackage({ body, currentUser, context: contextFrom(tenantId, idempotencyKey, request) });
  }
}
