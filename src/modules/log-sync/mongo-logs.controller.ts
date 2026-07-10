import { Controller, Get, Query } from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiResponse } from '@nestjs/swagger';
import { zodObjectPropertySchemas } from '../../common/openapi/zod-to-schema.util.js';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import { SystemsOpsControllerSecurity } from '../systems-ops/systems-controller.decorators.js';
import { mongoLogsQuerySchema, MongoLogsQueryDto } from './mongo-logs.schemas.js';
import { MongoLogsQueryService } from './mongo-logs-query.service.js';

@Controller('systems/logs')
@SystemsOpsControllerSecurity()
export class MongoLogsController {
  constructor(private readonly service: MongoLogsQueryService) {}

  @ApiOperation({ summary: 'Listar logs sincronizados a MongoDB (Archivo.log remoto)' })
  @ApiQuery({ name: 'type', required: false, schema: zodObjectPropertySchemas(mongoLogsQuerySchema).type })
  @ApiQuery({ name: 'service', required: false, schema: zodObjectPropertySchemas(mongoLogsQuerySchema).service })
  @ApiQuery({ name: 'q', required: false, schema: zodObjectPropertySchemas(mongoLogsQuerySchema).q })
  @ApiQuery({ name: 'from', required: false, schema: zodObjectPropertySchemas(mongoLogsQuerySchema).from })
  @ApiQuery({ name: 'to', required: false, schema: zodObjectPropertySchemas(mongoLogsQuerySchema).to })
  @ApiQuery({ name: 'page', required: false, schema: zodObjectPropertySchemas(mongoLogsQuerySchema).page })
  @ApiQuery({ name: 'limit', required: false, schema: zodObjectPropertySchemas(mongoLogsQuerySchema).limit })
  @ApiResponse({ status: 200, description: 'Lista paginada de logs desde MongoDB.' })
  @ApiResponse({ status: 503, description: 'MONGO_LOGS_NOT_CONFIGURED.' })
  @Get('mongo')
  listMongoLogs(@Query(new ZodValidationPipe(mongoLogsQuerySchema)) query: MongoLogsQueryDto) {
    return this.service.listLogs(query);
  }
}
