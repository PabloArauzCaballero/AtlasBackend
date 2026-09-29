/**
 * @file Adaptador HTTP: valida y autoriza la petición antes de delegar el caso de uso.
 * @business Esta pieza gobierna las reglas de riesgo vigentes y las políticas de tratamiento de datos.
 * @system expone la consulta y activación de rulesets de riesgo y la publicación de políticas de gobierno.
 */
import { Body, Controller, Get, Headers, HttpCode, HttpStatus, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiHeader, ApiOperation, ApiParam, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
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
import { InternalPermissionsGuard } from '../internal-users/guards/internal-permissions.guard.js';
import { InternalPermissions } from '../internal-users/internal-permissions.decorator.js';
import { contextFrom } from './catalog-request-context.util.js';
import { GOVERNANCE_POLICY_TYPES, governancePolicySearchSchema, type GovernancePolicySearchDto } from './catalog-list.schemas.js';
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
@UseGuards(JwtAuthGuard, TenantGuard, RolesGuard, InternalPermissionsGuard)
export class CatalogGovernanceController {
  constructor(private readonly service: CatalogManagementService) {}

  @Roles('internal_operator', 'risk_analyst', 'compliance_analyst', 'admin', 'platform_admin')
  @ApiOperation({ summary: 'Obtener la política de riesgo activa' })
  @ApiResponse({ status: 200, description: 'Política de riesgo actual (ruleset activo).' })
  @Get('risk-policy/current')
  getCurrentRiskPolicy(@CurrentUser() currentUser: AuthenticatedUser) {
    return this.service.getCurrentRiskPolicy({ currentUser });
  }

  @Roles('admin', 'platform_admin')
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

  /*
   * Las políticas de gobierno las lee quien tiene `governance.policies.read`, que es lo que el menú del
   * portal pide para enseñarlas. El auditor lo tiene y su rol de sesión (`readonly_auditor`) no estaba
   * en la lista: veía la entrada y recibía 403. Al abrir el rol se exige el permiso, para que abrirlo
   * no se lo dé a todo `internal_operator` (soporte, cobranza) sin más.
   */
  @Roles('internal_operator', 'risk_analyst', 'compliance_analyst', 'readonly_auditor', 'admin', 'platform_admin')
  @InternalPermissions('governance.policies.read')
  @ApiOperation({ summary: 'Obtener las políticas de gobernanza de datos activas' })
  @ApiResponse({ status: 200, description: 'Políticas de gobernanza (propósitos, clasificaciones, retenciones).' })
  @ApiResponse({ status: 403, description: 'Sin el permiso governance.policies.read.' })
  @Get('data-governance/policies')
  getDataGovernancePolicies(@CurrentUser() currentUser: AuthenticatedUser) {
    return this.service.getDataGovernancePolicies({ currentUser });
  }

  /*
   * La misma información que `data-governance/policies`, pero como una lista paginada con buscador,
   * filtro por tipo y conteos del filtro entero: la pantalla pintaba seis listas enteras como un muro
   * de tarjetas. Mismo rol y mismo permiso que la ruta de al lado.
   */
  @Roles('internal_operator', 'risk_analyst', 'compliance_analyst', 'readonly_auditor', 'admin', 'platform_admin')
  @InternalPermissions('governance.policies.read')
  @ApiOperation({
    summary: 'Buscar políticas de gobierno de datos (paginado)',
    description:
      'Propósitos de tratamiento, retenciones, clasificaciones, campos sensibles y reglas de calidad activos en una sola lista, ' +
      'ordenada por tipo y código. `policyId` es el que acepta `GET /internal/governance/policies/:policyId`. `summary` ' +
      '(total, byType, sensitiveFields, explicitConsent, protectedClasses) cuenta el filtro entero, no la página.',
  })
  @ApiQuery({
    name: 'q',
    required: false,
    schema: { type: 'string', maxLength: 200 },
    description: 'Contiene (sin mayúsculas) en código, nombre o alcance.',
  })
  @ApiQuery({
    name: 'type',
    required: false,
    schema: { type: 'string', enum: [...GOVERNANCE_POLICY_TYPES] },
    description: 'Tipo de política.',
  })
  @ApiQuery({ name: 'page', required: false, schema: { type: 'integer', minimum: 1, default: 1 }, description: 'Página, desde 1.' })
  @ApiQuery({
    name: 'limit',
    required: false,
    schema: { type: 'integer', minimum: 1, maximum: 100, default: 20 },
    description: 'Elementos por página (1-100).',
  })
  @ApiResponse({ status: 200, description: 'Página de políticas con `meta` y `summary`.' })
  @ApiResponse({ status: 403, description: 'Sin el permiso governance.policies.read.' })
  @Get('data-governance/policies/search')
  searchDataGovernancePolicies(
    @Query(new ZodValidationPipe(governancePolicySearchSchema)) query: GovernancePolicySearchDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    return this.service.searchDataGovernancePolicies({ query, currentUser });
  }

  /*
   * Publicar el paquete es `governance.policies.manage`. `DATA_GOVERNANCE_MANAGER` lo tiene, pero su
   * rol de sesión es `internal_operator`, que no estaba admitido: justo quien gobierna los datos no
   * podía publicar sus políticas. Se admite el rol y se exige el permiso.
   */
  @Roles('internal_operator', 'admin', 'platform_admin')
  @InternalPermissions('governance.policies.manage')
  @ApiOperation({ summary: 'Publicar un paquete de políticas de gobernanza de datos' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  @ApiHeader({ name: 'x-idempotency-key', required: true })
  @ApiBody({ schema: zodToApiSchema(dataGovernancePolicyPackageSchema) })
  @ApiResponse({ status: 200, description: 'Paquete de gobernanza de datos aplicado.' })
  @ApiResponse({ status: 403, description: 'Sin el permiso governance.policies.manage.' })
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
