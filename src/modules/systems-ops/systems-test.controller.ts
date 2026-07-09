import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBody, ApiOperation, ApiParam, ApiQuery, ApiResponse } from '@nestjs/swagger';
import { zodObjectPropertySchemas, zodToApiSchema } from '../../common/openapi/zod-to-schema.util.js';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import { Roles } from '../../common/decorators/roles.decorator.js';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import { AuthenticatedUser } from '../../common/types/auth.types.js';
import { SystemsOpsControllerSecurity } from './systems-controller.decorators.js';
import { SYSTEMS_OPS_WRITE_ROLES } from './systems-ops.constants.js';
import {
  createTestStepSchema,
  CreateTestStepDto,
  createTestSuiteSchema,
  CreateTestSuiteDto,
  reorderTestStepsSchema,
  ReorderTestStepsDto,
  runTestSuiteSchema,
  RunTestSuiteDto,
  systemsRunsQuerySchema,
  SystemsRunsQueryDto,
  systemsRunParamsSchema,
  SystemsRunParamsDto,
  systemsSuiteParamsSchema,
  SystemsSuiteParamsDto,
  systemsSuiteQuerySchema,
  SystemsSuiteQueryDto,
  systemsTestStepParamsSchema,
  SystemsTestStepParamsDto,
  updateTestStepSchema,
  UpdateTestStepDto,
  updateTestSuiteSchema,
  UpdateTestSuiteDto,
} from './systems-ops.schemas.js';
import { SystemsTestQueryService } from './systems-test-query.service.js';
import { SystemsTestSuiteAdminService } from './systems-test-suite-admin.service.js';

@Controller('systems')
@SystemsOpsControllerSecurity()
export class SystemsTestController {
  constructor(
    private readonly service: SystemsTestQueryService,
    private readonly suiteAdminService: SystemsTestSuiteAdminService,
  ) {}

  @ApiOperation({ summary: 'Crear una suite de pruebas' })
  @ApiBody({ schema: zodToApiSchema(createTestSuiteSchema) })
  @ApiResponse({ status: 201, description: 'Suite de pruebas creada.' })
  @Roles(...SYSTEMS_OPS_WRITE_ROLES)
  @Post('test-suites')
  createTestSuite(@Body(new ZodValidationPipe(createTestSuiteSchema)) body: CreateTestSuiteDto, @CurrentUser() user: AuthenticatedUser) {
    return this.suiteAdminService.createSuite(body, user);
  }

  @ApiOperation({ summary: 'Listar suites de pruebas' })
  @ApiQuery({ name: 'module', required: false, schema: zodObjectPropertySchemas(systemsSuiteQuerySchema).module })
  @ApiQuery({ name: 'suiteType', required: false, schema: zodObjectPropertySchemas(systemsSuiteQuerySchema).suiteType })
  @ApiQuery({ name: 'enabled', required: false, schema: zodObjectPropertySchemas(systemsSuiteQuerySchema).enabled })
  @ApiQuery({ name: 'page', required: false, schema: zodObjectPropertySchemas(systemsSuiteQuerySchema).page })
  @ApiQuery({ name: 'limit', required: false, schema: zodObjectPropertySchemas(systemsSuiteQuerySchema).limit })
  @ApiResponse({ status: 200, description: 'Lista paginada de suites.' })
  @Get('test-suites')
  listTestSuites(@Query(new ZodValidationPipe(systemsSuiteQuerySchema)) query: SystemsSuiteQueryDto) {
    return this.service.listTestSuites(query);
  }

  @ApiOperation({ summary: 'Obtener una suite de pruebas (con sus steps)' })
  @ApiParam({ name: 'suiteId', schema: zodToApiSchema(systemsSuiteParamsSchema.shape.suiteId) })
  @ApiResponse({ status: 200, description: 'Detalle de la suite.' })
  @ApiResponse({ status: 404, description: 'TEST_SUITE_NOT_FOUND.' })
  @Get('test-suites/:suiteId')
  getTestSuite(@Param(new ZodValidationPipe(systemsSuiteParamsSchema)) params: SystemsSuiteParamsDto) {
    return this.service.getTestSuite(params.suiteId);
  }

  @ApiOperation({ summary: 'Actualizar una suite de pruebas' })
  @ApiParam({ name: 'suiteId', schema: zodToApiSchema(systemsSuiteParamsSchema.shape.suiteId) })
  @ApiBody({ schema: zodToApiSchema(updateTestSuiteSchema) })
  @ApiResponse({ status: 200, description: 'Suite actualizada.' })
  @ApiResponse({ status: 404, description: 'TEST_SUITE_NOT_FOUND.' })
  @Roles(...SYSTEMS_OPS_WRITE_ROLES)
  @Patch('test-suites/:suiteId')
  updateTestSuite(
    @Param(new ZodValidationPipe(systemsSuiteParamsSchema)) params: SystemsSuiteParamsDto,
    @Body(new ZodValidationPipe(updateTestSuiteSchema)) body: UpdateTestSuiteDto,
  ) {
    return this.suiteAdminService.updateSuite(params.suiteId, body);
  }

  @ApiOperation({ summary: 'Crear un step dentro de una suite de pruebas' })
  @ApiParam({ name: 'suiteId', schema: zodToApiSchema(systemsSuiteParamsSchema.shape.suiteId) })
  @ApiBody({ schema: zodToApiSchema(createTestStepSchema) })
  @ApiResponse({ status: 201, description: 'Step creado.' })
  @ApiResponse({ status: 404, description: 'TEST_SUITE_NOT_FOUND.' })
  @Roles(...SYSTEMS_OPS_WRITE_ROLES)
  @Post('test-suites/:suiteId/steps')
  createTestStep(
    @Param(new ZodValidationPipe(systemsSuiteParamsSchema)) params: SystemsSuiteParamsDto,
    @Body(new ZodValidationPipe(createTestStepSchema)) body: CreateTestStepDto,
  ) {
    return this.suiteAdminService.createStep(params.suiteId, body);
  }

  @ApiOperation({ summary: 'Actualizar un step de una suite de pruebas' })
  @ApiParam({ name: 'suiteId', schema: zodToApiSchema(systemsTestStepParamsSchema.shape.suiteId) })
  @ApiParam({ name: 'stepId', schema: zodToApiSchema(systemsTestStepParamsSchema.shape.stepId) })
  @ApiBody({ schema: zodToApiSchema(updateTestStepSchema) })
  @ApiResponse({ status: 200, description: 'Step actualizado.' })
  @ApiResponse({ status: 404, description: 'TEST_STEP_NOT_FOUND.' })
  @Roles(...SYSTEMS_OPS_WRITE_ROLES)
  @Patch('test-suites/:suiteId/steps/:stepId')
  updateTestStep(
    @Param(new ZodValidationPipe(systemsTestStepParamsSchema)) params: SystemsTestStepParamsDto,
    @Body(new ZodValidationPipe(updateTestStepSchema)) body: UpdateTestStepDto,
  ) {
    return this.suiteAdminService.updateStep(params.suiteId, params.stepId, body);
  }

  @ApiOperation({ summary: 'Reordenar los steps de una suite de pruebas' })
  @ApiParam({ name: 'suiteId', schema: zodToApiSchema(systemsSuiteParamsSchema.shape.suiteId) })
  @ApiBody({ schema: zodToApiSchema(reorderTestStepsSchema) })
  @ApiResponse({ status: 200, description: 'Steps reordenados.' })
  @ApiResponse({ status: 404, description: 'TEST_SUITE_NOT_FOUND.' })
  @Roles(...SYSTEMS_OPS_WRITE_ROLES)
  @Post('test-suites/:suiteId/steps/reorder')
  reorderTestSteps(
    @Param(new ZodValidationPipe(systemsSuiteParamsSchema)) params: SystemsSuiteParamsDto,
    @Body(new ZodValidationPipe(reorderTestStepsSchema)) body: ReorderTestStepsDto,
  ) {
    return this.suiteAdminService.reorderSteps(params.suiteId, body);
  }

  @ApiOperation({ summary: 'Ejecutar una suite de pruebas' })
  @ApiParam({ name: 'suiteId', schema: zodToApiSchema(systemsSuiteParamsSchema.shape.suiteId) })
  @ApiBody({ schema: zodToApiSchema(runTestSuiteSchema) })
  @ApiResponse({ status: 201, description: 'Corrida de suite iniciada/encolada.' })
  @ApiResponse({ status: 404, description: 'TEST_SUITE_NOT_FOUND.' })
  @Roles(...SYSTEMS_OPS_WRITE_ROLES)
  @Post('test-suites/:suiteId/run')
  runTestSuite(
    @Param(new ZodValidationPipe(systemsSuiteParamsSchema)) params: SystemsSuiteParamsDto,
    @Body(new ZodValidationPipe(runTestSuiteSchema)) body: RunTestSuiteDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.runTestSuite(params.suiteId, body, user);
  }

  @ApiOperation({ summary: 'Listar corridas de suites de pruebas' })
  @ApiQuery({ name: 'suiteId', required: false, schema: zodObjectPropertySchemas(systemsRunsQuerySchema).suiteId })
  @ApiQuery({ name: 'status', required: false, schema: zodObjectPropertySchemas(systemsRunsQuerySchema).status })
  @ApiQuery({ name: 'environment', required: false, schema: zodObjectPropertySchemas(systemsRunsQuerySchema).environment })
  @ApiQuery({ name: 'page', required: false, schema: zodObjectPropertySchemas(systemsRunsQuerySchema).page })
  @ApiQuery({ name: 'limit', required: false, schema: zodObjectPropertySchemas(systemsRunsQuerySchema).limit })
  @ApiResponse({ status: 200, description: 'Lista paginada de corridas.' })
  @Get('test-runs')
  listTestRuns(@Query(new ZodValidationPipe(systemsRunsQuerySchema)) query: SystemsRunsQueryDto) {
    return this.service.listTestRuns(query);
  }

  @ApiOperation({ summary: 'Obtener una corrida de suite de pruebas' })
  @ApiParam({ name: 'runId', schema: zodToApiSchema(systemsRunParamsSchema.shape.runId) })
  @ApiResponse({ status: 200, description: 'Detalle de la corrida.' })
  @ApiResponse({ status: 404, description: 'TEST_RUN_NOT_FOUND.' })
  @Get('test-runs/:runId')
  getTestRun(@Param(new ZodValidationPipe(systemsRunParamsSchema)) params: SystemsRunParamsDto) {
    return this.service.getTestRun(params.runId);
  }
}
