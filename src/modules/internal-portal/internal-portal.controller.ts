import { Body, Controller, Get, HttpCode, HttpStatus, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard.js';
import { RolesGuard } from '../../common/guards/roles.guard.js';
import { Roles } from '../../common/decorators/roles.decorator.js';
import { InternalPortalService } from './internal-portal.service.js';

type QueryRecord = Record<string, string | number | boolean | undefined>;
type BodyRecord = Record<string, unknown>;

/**
 * ATLAS-AUDIT (auditoría #18, `internal-portal`): antes de este cambio, el controller completo
 * (17 endpoints — glosario de metadata de negocio, exports, reglas de calidad de datos,
 * políticas de gobierno de datos incluyendo un PATCH, linaje de datos, alertas —
 * `acknowledgeAlert` ejecuta un UPDATE real —, jobs, reportes) solo tenía `@UseGuards(JwtAuthGuard)`,
 * sin `RolesGuard` ni `@Roles(...)` en ningún endpoint. `JwtAuthGuard` únicamente valida que el
 * token sea válido y no esté revocado — no valida rol. Cualquier actor autenticado, incluido un
 * `customer`, tenía acceso completo a este panel "interno". Este conjunto de roles replica el de
 * los módulos hermanos con audiencia equivalente (`operations`, `data-quality`, `audit`,
 * `systems-ops`) — es la corrección crítica inmediata (de "cualquiera" a "solo interno"); afinar
 * qué subconjunto de estos roles debería tener acceso de escritura específicamente es un refinamiento
 * posterior, no bloquea cerrar el hueco de autorización.
 */
const INTERNAL_PORTAL_ROLES = [
  'internal_operator',
  'risk_analyst',
  'compliance_analyst',
  'admin',
  'platform_admin',
  'system_admin',
  'qa_engineer',
  'devops',
  'readonly_auditor',
] as const;

@ApiTags('internal-portal')
@ApiBearerAuth('access-token')
@Controller('internal')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(...INTERNAL_PORTAL_ROLES)
export class InternalPortalController {
  constructor(private readonly service: InternalPortalService) {}

  @ApiOperation({ summary: 'Listar términos del glosario de metadata de negocio' })
  @ApiResponse({ status: 200, description: 'Lista de términos del glosario.' })
  @Get('business-metadata/glossary')
  listBusinessTerms(@Query() query: QueryRecord) {
    return this.service.listBusinessTerms(query);
  }

  @ApiOperation({ summary: 'Obtener un término del glosario de negocio' })
  @ApiParam({ name: 'termId' })
  @ApiResponse({ status: 200, description: 'Detalle del término.' })
  @Get('business-metadata/terms/:termId')
  getBusinessTerm(@Param('termId') termId: string) {
    return this.service.getBusinessTerm(termId);
  }

  @ApiOperation({ summary: 'Listar exports registrados' })
  @ApiResponse({ status: 200, description: 'Lista de exports.' })
  @Get('exports')
  listExports(@Query() query: QueryRecord) {
    return this.service.listExports(query);
  }

  @ApiOperation({ summary: 'Obtener un export registrado' })
  @ApiParam({ name: 'exportId' })
  @ApiResponse({ status: 200, description: 'Detalle del export.' })
  @Get('exports/:exportId')
  getExport(@Param('exportId') exportId: string) {
    return this.service.getExport(exportId);
  }

  @ApiOperation({ summary: 'Listar reglas de calidad de datos' })
  @ApiResponse({ status: 200, description: 'Lista de reglas de calidad de datos.' })
  @Get('data-quality/rules')
  listDataQualityRules(@Query() query: QueryRecord) {
    return this.service.listDataQualityRules(query);
  }

  @ApiOperation({ summary: 'Obtener una regla de calidad de datos' })
  @ApiParam({ name: 'ruleId' })
  @ApiResponse({ status: 200, description: 'Detalle de la regla.' })
  @Get('data-quality/rules/:ruleId')
  getDataQualityRule(@Param('ruleId') ruleId: string) {
    return this.service.getDataQualityRule(ruleId);
  }

  @ApiOperation({ summary: 'Ejecutar una regla de calidad de datos bajo demanda' })
  @ApiParam({ name: 'ruleId' })
  @ApiResponse({ status: 200, description: 'Resultado de la ejecución de la regla.' })
  @Post('data-quality/rules/:ruleId/run')
  @HttpCode(HttpStatus.OK)
  runDataQualityRule(@Param('ruleId') ruleId: string) {
    return this.service.runDataQualityRule(ruleId);
  }

  @ApiOperation({ summary: 'Obtener una política de gobierno de datos' })
  @ApiParam({ name: 'policyId' })
  @ApiResponse({ status: 200, description: 'Detalle de la política.' })
  @Get('governance/policies/:policyId')
  getGovernancePolicy(@Param('policyId') policyId: string) {
    return this.service.getGovernancePolicy(policyId);
  }

  @ApiOperation({ summary: 'Actualizar una política de gobierno de datos' })
  @ApiParam({ name: 'policyId' })
  @ApiResponse({ status: 200, description: 'Política actualizada.' })
  @Patch('governance/policies/:policyId')
  updateGovernancePolicy(@Param('policyId') policyId: string, @Body() body: BodyRecord) {
    return this.service.updateGovernancePolicy(policyId, body);
  }

  @ApiOperation({ summary: 'Consultar el grafo de linaje de datos' })
  @ApiResponse({ status: 200, description: 'Grafo de linaje de datos.' })
  @Get('lineage')
  getLineage(@Query() query: QueryRecord) {
    return this.service.getLineage(query);
  }

  @ApiOperation({ summary: 'Obtener un nodo de linaje de datos' })
  @ApiParam({ name: 'nodeId' })
  @ApiResponse({ status: 200, description: 'Detalle del nodo de linaje.' })
  @Get('lineage/nodes/:nodeId')
  getLineageNode(@Param('nodeId') nodeId: string) {
    return this.service.getLineageNode(nodeId);
  }

  @ApiOperation({ summary: 'Analizar impacto de linaje de datos (aguas abajo/arriba)' })
  @ApiResponse({ status: 200, description: 'Análisis de impacto de linaje.' })
  @Get('lineage/impact')
  getLineageImpact(@Query() query: QueryRecord) {
    return this.service.getLineageImpact(query);
  }

  @ApiOperation({ summary: 'Listar alertas del panel interno' })
  @ApiResponse({ status: 200, description: 'Lista de alertas.' })
  @Get('alerts')
  listAlerts(@Query() query: QueryRecord) {
    return this.service.listAlerts(query);
  }

  @ApiOperation({ summary: 'Reconocer (acknowledge) una alerta' })
  @ApiParam({ name: 'alertId' })
  @ApiResponse({ status: 200, description: 'Alerta reconocida.' })
  @Post('alerts/:alertId/acknowledge')
  @HttpCode(HttpStatus.OK)
  acknowledgeAlert(@Param('alertId') alertId: string) {
    return this.service.acknowledgeAlert(alertId);
  }

  @ApiOperation({ summary: 'Listar corridas de jobs' })
  @ApiResponse({ status: 200, description: 'Lista de corridas de jobs.' })
  @Get('jobs')
  listJobs(@Query() query: QueryRecord) {
    return this.service.listJobs(query);
  }

  @ApiOperation({ summary: 'Obtener una corrida de job' })
  @ApiParam({ name: 'jobRunId' })
  @ApiResponse({ status: 200, description: 'Detalle de la corrida de job.' })
  @Get('jobs/:jobRunId')
  getJob(@Param('jobRunId') jobRunId: string) {
    return this.service.getJob(jobRunId);
  }

  @ApiOperation({ summary: 'Reintentar una corrida de job' })
  @ApiParam({ name: 'jobRunId' })
  @ApiResponse({ status: 200, description: 'Job re-encolado.' })
  @Post('jobs/:jobRunId/retry')
  @HttpCode(HttpStatus.OK)
  retryJob(@Param('jobRunId') jobRunId: string) {
    return this.service.retryJob(jobRunId);
  }

  @ApiOperation({ summary: 'Cancelar una corrida de job' })
  @ApiParam({ name: 'jobRunId' })
  @ApiResponse({ status: 200, description: 'Job cancelado.' })
  @Post('jobs/:jobRunId/cancel')
  @HttpCode(HttpStatus.OK)
  cancelJob(@Param('jobRunId') jobRunId: string) {
    return this.service.cancelJob(jobRunId);
  }

  @ApiOperation({ summary: 'Resumen de disponibilidad para release (release readiness)' })
  @ApiResponse({ status: 200, description: 'Resumen de release readiness.' })
  @Get('release-readiness')
  getReleaseReadiness() {
    return this.service.getReleaseReadiness();
  }

  @ApiOperation({ summary: 'Listar reportes registrados' })
  @ApiResponse({ status: 200, description: 'Lista de reportes.' })
  @Get('reports')
  listReports(@Query() query: QueryRecord) {
    return this.service.listReports(query);
  }

  @ApiOperation({ summary: 'Obtener un reporte registrado' })
  @ApiParam({ name: 'reportId' })
  @ApiResponse({ status: 200, description: 'Detalle del reporte.' })
  @Get('reports/:reportId')
  getReport(@Param('reportId') reportId: string) {
    return this.service.getReport(reportId);
  }

  @ApiOperation({ summary: 'Ejecutar un reporte bajo demanda' })
  @ApiParam({ name: 'reportId' })
  @ApiResponse({ status: 200, description: 'Snapshot del reporte generado.' })
  @Post('reports/:reportId/run')
  @HttpCode(HttpStatus.OK)
  runReport(@Param('reportId') reportId: string, @Body() body: BodyRecord) {
    return this.service.runReport(reportId, body);
  }

  @ApiOperation({ summary: 'Listar snapshots históricos de un reporte' })
  @ApiParam({ name: 'reportId' })
  @ApiResponse({ status: 200, description: 'Lista de snapshots del reporte.' })
  @Get('reports/:reportId/snapshots')
  listReportSnapshots(@Param('reportId') reportId: string, @Query() query: QueryRecord) {
    return this.service.listReportSnapshots(reportId, query);
  }

  @ApiOperation({ summary: 'Búsqueda global dentro del panel interno' })
  @ApiResponse({ status: 200, description: 'Resultados de búsqueda.' })
  @Get('search')
  search(@Query() query: QueryRecord) {
    return this.service.search(query);
  }
}
