/**
 * @file Adaptador HTTP: valida y autoriza la petición antes de delegar el caso de uso.
 * @business Esta pieza ofrece a operaciones una vista gobernada del negocio sin acceso directo a tablas sensibles.
 * @system compone consultas read-only, reportes, glosario, linaje y búsqueda para el portal administrativo.
 */
import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard.js';
import { RolesGuard } from '../../common/guards/roles.guard.js';
import { TenantGuard } from '../../common/guards/tenant.guard.js';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import { Roles } from '../../common/decorators/roles.decorator.js';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import { zodToApiSchema } from '../../common/openapi/zod-to-schema.util.js';
import { AuthenticatedUser } from '../../common/types/auth.types.js';
import { InternalPortalService } from './internal-portal.service.js';
import { ApiDataQualityRulesDocs, ApiDeprecatedAcknowledgeDocs, ApiDeprecatedAlertsDocs } from './data-quality-portal.openapi.js';
import { portalScopeFor } from './application/portal-scope.util.js';
import { INTERNAL_PORTAL_ROLES } from './internal-portal.roles.js';
import {
  ApiPortalFacetQuery,
  ApiPortalListQuery,
  ApiPortalSearchQuery,
  portalIdParamSchema,
  portalListQuerySchema,
  PortalListQueryDto,
  portalAlertsQuerySchema,
  portalDataQualityRulesQuerySchema,
  PortalDataQualityRulesQueryDto,
  PortalAlertsQueryDto,
  portalJobsQuerySchema,
  PortalJobsQueryDto,
  portalSearchQuerySchema,
  PortalSearchQueryDto,
  portalReportsQuerySchema,
  PortalReportsQueryDto,
  runReportSchema,
  RunReportDto,
} from './internal-portal.schemas.js';

/**
 * Portal interno de operación y gobierno de datos.
 *
 * Dos cambios de fondo respecto de la versión anterior (auditoría integral 2026-08-06):
 *
 * 1. **Alcance por tenant** (ATLAS-SEC-009). `portalScopeFor(currentUser)` deriva el alcance del
 *    token y cada caso de uso lo recibe explícitamente. Las dos tablas del portal que llevan
 *    `_tenant_id` —`system_job_runs` y `data_quality_issues`— se consultaban sin filtrarlo: un
 *    operador de un tenant leía las corridas de job de otro y podía reconocer sus alertas.
 *    `TenantGuard` se añade además para que un `x-tenant-id` que contradiga al token sea 403.
 *
 * 2. **Contrato de entrada** (ATLAS-SEC-010). Todos los `@Query`/`@Param`/`@Body` pasan por
 *    `ZodValidationPipe`; antes eran `Record<string, unknown>` sin validar, únicos en el backend.
 *
 * Endpoints retirados en el mismo cambio, por devolver 200 sobre acciones que no ocurrían:
 * `POST /jobs/:id/retry`, `POST /jobs/:id/cancel`, `POST /data-quality/rules/:id/run`,
 * `PATCH /governance/policies/:id` y `GET /reports/:id/snapshots`. Las capacidades REALES viven en
 * `runtime-jobs` (`POST /runtime-jobs/recalculate-data-quality`, `/process-outbox`, …), que sí
 * ejecutan, registran su corrida en `system_job_runs` y están cubiertas por pruebas.
 */
@ApiTags('internal-portal')
@ApiBearerAuth('access-token')
@Controller('internal')
@UseGuards(JwtAuthGuard, TenantGuard, RolesGuard)
@Roles(...INTERNAL_PORTAL_ROLES)
export class InternalPortalController {
  constructor(private readonly service: InternalPortalService) {}

  @ApiOperation({
    summary: 'Listar catálogos exportables',
    description:
      'Descriptores de los catálogos que pueden descargarse y su volumen actual. No son ejecuciones de export: el modelo no ' +
      'persiste exports, así que no se publican `status`, `requestedBy` ni marcas de tiempo de una ejecución inexistente.',
  })
  @ApiResponse({ status: 200, description: 'Catálogos exportables disponibles.' })
  @Get('exports')
  listExports(@Query(new ZodValidationPipe(portalListQuerySchema)) query: PortalListQueryDto) {
    return this.service.listExports(query);
  }

  @ApiOperation({ summary: 'Obtener un catálogo exportable' })
  @ApiParam({ name: 'exportId' })
  @ApiResponse({ status: 200, description: 'Detalle del catálogo exportable.' })
  @ApiResponse({ status: 404, description: 'DATA_EXPORT_NOT_FOUND.' })
  @Get('exports/:exportId')
  getExport(@Param(new ZodValidationPipe(portalIdParamSchema('exportId'))) params: { exportId: string }) {
    return this.service.getExport(params.exportId);
  }

  @ApiDataQualityRulesDocs()
  @Get('data-quality/rules')
  listDataQualityRules(
    @Query(new ZodValidationPipe(portalDataQualityRulesQuerySchema)) query: PortalDataQualityRulesQueryDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    return this.service.listDataQualityRules(portalScopeFor(currentUser), query);
  }

  @ApiOperation({ summary: 'Obtener una regla de calidad de datos' })
  @ApiParam({ name: 'ruleId' })
  @ApiResponse({ status: 200, description: 'Detalle de la regla.' })
  @ApiResponse({ status: 404, description: 'DATA_QUALITY_RULE_NOT_FOUND.' })
  @Get('data-quality/rules/:ruleId')
  getDataQualityRule(
    @Param(new ZodValidationPipe(portalIdParamSchema('ruleId'))) params: { ruleId: string },
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    return this.service.getDataQualityRule(portalScopeFor(currentUser), params.ruleId);
  }

  @ApiOperation({
    summary: 'Obtener una política de gobierno de datos',
    description:
      'Solo lectura. Las políticas de gobierno son artefactos versionados (migración o seeder revisable), no filas editables ' +
      'desde el panel: el antiguo `PATCH` respondía 200 sin persistir nada.',
  })
  @ApiParam({ name: 'policyId' })
  @ApiResponse({ status: 200, description: 'Detalle de la política.' })
  @ApiResponse({ status: 404, description: 'GOVERNANCE_POLICY_NOT_FOUND.' })
  @Get('governance/policies/:policyId')
  getGovernancePolicy(@Param(new ZodValidationPipe(portalIdParamSchema('policyId'))) params: { policyId: string }) {
    return this.service.getGovernancePolicy(params.policyId);
  }

  @ApiDeprecatedAlertsDocs()
  @Get('alerts')
  listAlerts(
    @Query(new ZodValidationPipe(portalAlertsQuerySchema)) query: PortalAlertsQueryDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    return this.service.listAlerts(portalScopeFor(currentUser), query);
  }

  @ApiDeprecatedAcknowledgeDocs()
  @Post('alerts/:alertId/acknowledge')
  @HttpCode(HttpStatus.OK)
  acknowledgeAlert(
    @Param(new ZodValidationPipe(portalIdParamSchema('alertId'))) params: { alertId: string },
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    return this.service.acknowledgeAlert(portalScopeFor(currentUser), params.alertId);
  }

  @ApiOperation({
    summary: 'Listar corridas de jobs',
    description: 'Acotado al tenant del token. `summary.byStatus` cuenta TODAS las corridas del filtro, no sólo la página.',
  })
  @ApiPortalListQuery()
  @ApiPortalFacetQuery('status', 'Estado exacto de la corrida (COMPLETED, FAILED, RUNNING…).')
  @ApiPortalFacetQuery('queue', 'Origen del disparo (system, internal_user…).')
  @ApiResponse({ status: 200, description: 'Lista de corridas de jobs.' })
  @Get('jobs')
  listJobs(@Query(new ZodValidationPipe(portalJobsQuerySchema)) query: PortalJobsQueryDto, @CurrentUser() currentUser: AuthenticatedUser) {
    return this.service.listJobs(portalScopeFor(currentUser), query);
  }

  @ApiOperation({
    summary: 'Obtener una corrida de job',
    description:
      'Solo corridas del propio tenant. Para volver a EJECUTAR un job usa los endpoints de `runtime-jobs`, que disparan el ' +
      'trabajo real y registran su corrida; el portal es de lectura.',
  })
  @ApiParam({ name: 'jobRunId' })
  @ApiResponse({ status: 200, description: 'Detalle de la corrida de job.' })
  @ApiResponse({ status: 404, description: 'JOB_RUN_NOT_FOUND.' })
  @Get('jobs/:jobRunId')
  getJob(
    @Param(new ZodValidationPipe(portalIdParamSchema('jobRunId'))) params: { jobRunId: string },
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    return this.service.getJob(portalScopeFor(currentUser), params.jobRunId);
  }

  @ApiOperation({ summary: 'Resumen de disponibilidad para release (release readiness)' })
  @ApiResponse({ status: 200, description: 'Resumen de release readiness.' })
  @Get('release-readiness')
  getReleaseReadiness(@CurrentUser() currentUser: AuthenticatedUser) {
    return this.service.getReleaseReadiness(portalScopeFor(currentUser));
  }

  @ApiOperation({
    summary: 'Listar reportes registrados',
    description: 'Definiciones declaradas en código. `facets` y `summary` cuentan el catálogo entero y lo filtrado, no la página.',
  })
  @ApiPortalListQuery()
  @ApiPortalFacetQuery('domain', 'Dominio exacto del reporte (operations, systems, governance, risk…).')
  @ApiPortalFacetQuery('status', 'Estado exacto del reporte (ACTIVE…).')
  @ApiResponse({ status: 200, description: 'Lista de reportes.' })
  @Get('reports')
  listReports(@Query(new ZodValidationPipe(portalReportsQuerySchema)) query: PortalReportsQueryDto) {
    return this.service.listReports(query);
  }

  @ApiOperation({ summary: 'Obtener un reporte registrado' })
  @ApiParam({ name: 'reportId' })
  @ApiResponse({ status: 200, description: 'Detalle del reporte.' })
  @ApiResponse({ status: 404, description: 'REPORT_NOT_FOUND.' })
  @Get('reports/:reportId')
  getReport(@Param(new ZodValidationPipe(portalIdParamSchema('reportId'))) params: { reportId: string }) {
    return this.service.getReport(params.reportId);
  }

  @ApiOperation({
    summary: 'Computar un reporte bajo demanda',
    description:
      'Calcula el reporte EN VIVO sobre los datos del tenant del token y devuelve `persisted: false`: no existe tabla de ' +
      'snapshots, así que no se almacena ni se puede recuperar después.',
  })
  @ApiParam({ name: 'reportId' })
  @ApiBody({ schema: zodToApiSchema(runReportSchema), required: false })
  @ApiResponse({ status: 200, description: 'Reporte computado en vivo.' })
  @Post('reports/:reportId/run')
  @HttpCode(HttpStatus.OK)
  runReport(
    @Param(new ZodValidationPipe(portalIdParamSchema('reportId'))) params: { reportId: string },
    @Body(new ZodValidationPipe(runReportSchema)) body: RunReportDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    return this.service.runReport(portalScopeFor(currentUser), params.reportId, body);
  }

  @ApiOperation({ summary: 'Búsqueda global dentro del panel interno', description: '`totals` es un COUNT real por tipo.' })
  @ApiPortalSearchQuery()
  @ApiResponse({ status: 200, description: 'Resultados de búsqueda.' })
  @Get('search')
  search(@Query(new ZodValidationPipe(portalSearchQuerySchema)) query: PortalSearchQueryDto) {
    return this.service.search(query);
  }
}
