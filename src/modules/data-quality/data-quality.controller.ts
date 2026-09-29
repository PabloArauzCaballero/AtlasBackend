/**
 * @file Adaptador HTTP: valida y autoriza la petición antes de delegar el caso de uso.
 * @business Esta pieza evita decisiones crediticias basadas en datos incompletos, incoherentes o sin linaje.
 * @system administra reglas, ejecuciones y hallazgos de calidad consultables por operaciones.
 */
import { BadRequestException, Body, Controller, Get, Headers, HttpCode, HttpStatus, Param, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiHeader, ApiOperation, ApiParam, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { zodObjectPropertySchemas, zodToApiSchema } from '../../common/openapi/zod-to-schema.util.js';
import { CurrentTenant } from '../../common/decorators/current-tenant.decorator.js';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import { Roles } from '../../common/decorators/roles.decorator.js';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard.js';
import { RolesGuard } from '../../common/guards/roles.guard.js';
import { TenantGuard } from '../../common/guards/tenant.guard.js';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import { AuthenticatedUser } from '../../common/types/auth.types.js';
import { InternalPermissions } from '../internal-users/internal-permissions.decorator.js';
import { InternalPermissionsGuard } from '../internal-users/guards/internal-permissions.guard.js';
import { DataQualityService } from './data-quality.service.js';
import {
  dataQualityIssueParamsSchema,
  DataQualityIssueParamsDto,
  dataQualityQuerySchema,
  DataQualityQueryDto,
  resolveDataQualityIssueSchema,
  ResolveDataQualityIssueDto,
} from './data-quality.schemas.js';

@ApiTags('data-quality')
@ApiBearerAuth('access-token')
@Controller('operations/data-quality/issues')
@UseGuards(JwtAuthGuard, TenantGuard, RolesGuard, InternalPermissionsGuard)
@Roles('internal_operator', 'risk_analyst', 'compliance_analyst', 'admin', 'platform_admin')
export class DataQualityController {
  constructor(private readonly service: DataQualityService) {}

  /*
   * Leer la bandeja es `dataQuality.issues.read`, que es lo que el portal pide para enseñarla. El
   * auditor lo tiene y su rol de sesión (`readonly_auditor`) no estaba en la lista: veía la entrada y
   * recibía 403 — y con la bandeja absorbiendo la antigua pantalla «Alertas», que sí le dejaba leer,
   * habría perdido el acceso. Al abrir el rol se exige el permiso (mismo criterio que las políticas
   * de gobierno), para que abrirlo no se lo dé a todo `internal_operator` (soporte, cobranza).
   */
  @Roles('internal_operator', 'risk_analyst', 'compliance_analyst', 'readonly_auditor', 'admin', 'platform_admin')
  @InternalPermissions('dataQuality.issues.read')
  @ApiOperation({
    summary: 'Listar issues de calidad de datos',
    description:
      '`q` busca «contiene» en la tabla del registro, el código de la regla y las notas de la resolución. `severity` ' +
      '(LOW…CRITICAL) y `status` no distinguen mayúsculas; severity resuelve contra data_quality_rules. `summary` cuenta ' +
      'TODAS las incidencias del filtro, no sólo la página: `pending` = sin revisar + reconocidas (lo mismo que el semáforo ' +
      'de salida), `acknowledged`, `closed` (resolved/ignored/closed) y `byStatus`.',
  })
  @ApiResponse({ status: 403, description: 'Sin el permiso dataQuality.issues.read.' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  @ApiQuery({
    name: 'q',
    required: false,
    schema: zodObjectPropertySchemas(dataQualityQuerySchema).q,
    description: 'Texto libre: tabla del registro, código de la regla o notas de la resolución.',
  })
  @ApiQuery({ name: 'status', required: false, schema: zodObjectPropertySchemas(dataQualityQuerySchema).status })
  @ApiQuery({ name: 'severity', required: false, schema: zodObjectPropertySchemas(dataQualityQuerySchema).severity })
  @ApiQuery({ name: 'entityType', required: false, schema: zodObjectPropertySchemas(dataQualityQuerySchema).entityType })
  @ApiQuery({ name: 'customerId', required: false, schema: zodObjectPropertySchemas(dataQualityQuerySchema).customerId })
  @ApiResponse({ status: 200, description: 'Lista paginada de issues con `summary`.' })
  @Get()
  listIssues(@CurrentTenant() tenantId: string, @Query(new ZodValidationPipe(dataQualityQuerySchema)) query: DataQualityQueryDto) {
    return this.service.listIssues(tenantId, query);
  }

  @InternalPermissions('dataQuality.issues.resolve')
  @ApiOperation({
    summary: 'Resolver, descartar o reconocer un issue de calidad de datos',
    description:
      '`resolved` (corregido) e `ignored` (descartado) cierran la incidencia. `acknowledged` la reconoce con motivo y notas: ' +
      'sigue pendiente —cuenta en el semáforo de salida— y se puede cerrar después; reconocerla otra vez es idempotente. ' +
      'Sustituye a `POST /internal/alerts/:alertId/acknowledge` (deprecado).',
  })
  @ApiResponse({ status: 403, description: 'Sin el permiso dataQuality.issues.resolve.' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  @ApiHeader({ name: 'x-idempotency-key', required: true })
  @ApiParam({ name: 'issueId', schema: zodToApiSchema(dataQualityIssueParamsSchema.shape.issueId) })
  @ApiBody({ schema: zodToApiSchema(resolveDataQualityIssueSchema) })
  @ApiResponse({ status: 200, description: 'Issue resuelto, descartado o reconocido.' })
  @ApiResponse({ status: 404, description: 'DATA_QUALITY_ISSUE_NOT_FOUND.' })
  @ApiResponse({ status: 409, description: 'DATA_QUALITY_ISSUE_ALREADY_RESOLVED.' })
  @Post(':issueId/resolve')
  @HttpCode(HttpStatus.OK)
  resolveIssue(
    @CurrentTenant() tenantId: string,
    @Headers('x-idempotency-key') idempotencyKey: string | undefined,
    @Param(new ZodValidationPipe(dataQualityIssueParamsSchema)) params: DataQualityIssueParamsDto,
    @Body(new ZodValidationPipe(resolveDataQualityIssueSchema)) body: ResolveDataQualityIssueDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    if (!idempotencyKey) throw new BadRequestException('X-Idempotency-Key header is required.');
    return this.service.resolveIssue({
      tenantId: tenantId,
      params,
      body,
      currentUser,
      idempotencyKey,
    });
  }
}
