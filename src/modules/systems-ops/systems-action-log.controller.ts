import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiOperation, ApiParam, ApiQuery, ApiResponse } from '@nestjs/swagger';
import { zodObjectPropertySchemas, zodToApiSchema } from '../../common/openapi/zod-to-schema.util.js';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import { SystemsOpsControllerSecurity } from './systems-controller.decorators.js';
import {
  systemsActionLogQuerySchema,
  SystemsActionLogQueryDto,
  systemsRequestParamsSchema,
  SystemsRequestParamsDto,
  trafficLatencyQuerySchema,
  TrafficLatencyQueryDto,
} from './systems-ops.schemas.js';
import { SystemsActionLogQueryService } from './systems-action-log-query.service.js';

@Controller('systems')
@SystemsOpsControllerSecurity()
export class SystemsActionLogController {
  constructor(private readonly service: SystemsActionLogQueryService) {}

  @ApiOperation({ summary: 'Listar registros de auditoría de acciones internas (systems)' })
  @ApiQuery({ name: 'endpointId', required: false, schema: zodObjectPropertySchemas(systemsActionLogQuerySchema).endpointId })
  @ApiQuery({ name: 'requestId', required: false, schema: zodObjectPropertySchemas(systemsActionLogQuerySchema).requestId })
  @ApiQuery({ name: 'correlationId', required: false, schema: zodObjectPropertySchemas(systemsActionLogQuerySchema).correlationId })
  @ApiQuery({ name: 'method', required: false, schema: zodObjectPropertySchemas(systemsActionLogQuerySchema).method })
  @ApiQuery({ name: 'statusCode', required: false, schema: zodObjectPropertySchemas(systemsActionLogQuerySchema).statusCode })
  @ApiQuery({ name: 'actorType', required: false, schema: zodObjectPropertySchemas(systemsActionLogQuerySchema).actorType })
  @ApiQuery({ name: 'module', required: false, schema: zodObjectPropertySchemas(systemsActionLogQuerySchema).module })
  @ApiQuery({ name: 'riskLevel', required: false, schema: zodObjectPropertySchemas(systemsActionLogQuerySchema).riskLevel })
  @ApiQuery({ name: 'containsPii', required: false, schema: zodObjectPropertySchemas(systemsActionLogQuerySchema).containsPii })
  @ApiQuery({ name: 'from', required: false, schema: zodObjectPropertySchemas(systemsActionLogQuerySchema).from })
  @ApiQuery({ name: 'to', required: false, schema: zodObjectPropertySchemas(systemsActionLogQuerySchema).to })
  @ApiQuery({ name: 'page', required: false, schema: zodObjectPropertySchemas(systemsActionLogQuerySchema).page })
  @ApiQuery({ name: 'limit', required: false, schema: zodObjectPropertySchemas(systemsActionLogQuerySchema).limit })
  @ApiResponse({ status: 200, description: 'Lista paginada de action logs.' })
  @Get('action-logs')
  listActionLogs(@Query(new ZodValidationPipe(systemsActionLogQuerySchema)) query: SystemsActionLogQueryDto) {
    return this.service.listActionLogs(query);
  }

  @ApiOperation({ summary: 'Action logs de un request (alias)' })
  @ApiParam({ name: 'requestId', schema: zodToApiSchema(systemsRequestParamsSchema.shape.requestId) })
  @ApiResponse({ status: 200, description: 'Action logs asociados al request.' })
  @Get('action-logs/request/:requestId')
  getActionLogsByRequestAlias(@Param(new ZodValidationPipe(systemsRequestParamsSchema)) params: SystemsRequestParamsDto) {
    return this.service.getActionLogsByRequest(params.requestId);
  }

  @ApiOperation({ summary: 'Action logs de un request' })
  @ApiParam({ name: 'requestId', schema: zodToApiSchema(systemsRequestParamsSchema.shape.requestId) })
  @ApiResponse({ status: 200, description: 'Action logs asociados al request.' })
  @Get('action-logs/by-request/:requestId')
  getActionLogsByRequest(@Param(new ZodValidationPipe(systemsRequestParamsSchema)) params: SystemsRequestParamsDto) {
    return this.service.getActionLogsByRequest(params.requestId);
  }

  @ApiOperation({ summary: 'Reporte de tráfico y latencia por ruta (derivado de system_action_logs)' })
  @ApiQuery({ name: 'windowHours', required: false, schema: zodObjectPropertySchemas(trafficLatencyQuerySchema).windowHours })
  @ApiResponse({ status: 200, description: 'Resumen de tráfico y latencia por ruta/método.' })
  @Get('reports/traffic-latency')
  getTrafficLatencyReport(@Query(new ZodValidationPipe(trafficLatencyQuerySchema)) query: TrafficLatencyQueryDto) {
    return this.service.getTrafficLatencyReport(query.windowHours);
  }
}
