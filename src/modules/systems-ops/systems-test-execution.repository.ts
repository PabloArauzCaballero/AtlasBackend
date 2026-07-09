import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { FindAndCountOptions, FindOptions, WhereOptions } from 'sequelize';
import { buildPaginationMeta, toOffset } from '../../common/utils/pagination/pagination.util.js';
import { SystemTestRunModel, SystemTestStepModel, SystemTestStepRunModel, SystemTestSuiteModel } from '../../database/models/index.js';
import { SystemsRunsQueryDto, SystemsSuiteQueryDto } from './systems-ops.schemas.js';

export type UpsertTestSuiteInput = {
  code: string;
  name: string;
  description: string;
  module: string;
  suiteType: string;
  environmentScope: string[];
  isSafeForProduction?: boolean;
};

export type UpsertTestStepInput = {
  suiteId: string;
  endpointId: string | null;
  stepOrder: number;
  name: string;
  method: string;
  pathTemplate: string;
  inputMode?: string;
  defaultHeaders?: Record<string, unknown>;
  defaultPayload?: Record<string, unknown>;
  configSchema?: Record<string, unknown>;
  extractors?: Record<string, unknown>;
  assertions?: Record<string, unknown>;
  continueOnFailure?: boolean;
  cleanupRequired?: boolean;
};

export type CreateTestRunInput = {
  suiteId: string;
  environment: string;
  triggeredBy: string | null;
  status: string;
  startedAt: Date;
  summary: Record<string, unknown>;
};

export type FinishTestRunInput = { status: string; finishedAt: Date; durationMs: number; summary: Record<string, unknown> };

export type CreateTestStepRunInput = {
  testRunId: string;
  stepId: string;
  status: string;
  requestPayloadSanitized: Record<string, unknown>;
  responseBodySanitized: Record<string, unknown>;
  statusCode: number | null;
  durationMs: number | null;
  errorMessage: string | null;
  createdAt: Date;
};

@Injectable()
export class SystemsTestExecutionRepository {
  constructor(
    @InjectModel(SystemTestSuiteModel) private readonly suiteModel: typeof SystemTestSuiteModel,
    @InjectModel(SystemTestStepModel) private readonly stepModel: typeof SystemTestStepModel,
    @InjectModel(SystemTestRunModel) private readonly runModel: typeof SystemTestRunModel,
    @InjectModel(SystemTestStepRunModel) private readonly stepRunModel: typeof SystemTestStepRunModel,
  ) {}

  async upsertTestSuite(values: UpsertTestSuiteInput): Promise<SystemTestSuiteModel> {
    const now = new Date();
    const [suite] = await this.suiteModel.upsert({
      code: values.code,
      name: values.name,
      description: values.description,
      module: values.module,
      suiteType: values.suiteType,
      executionMode: 'SYNC_OR_JOB',
      environmentScope: values.environmentScope,
      isEnabled: true,
      requiresSeedData: true,
      isSafeForProduction: values.isSafeForProduction ?? false,
      requiresDestructivePermission: !(values.isSafeForProduction ?? false),
      createdBy: 'system_seed',
      createdAtValue: now,
      updatedAtValue: now,
    } as never);
    return suite;
  }

  async upsertTestStep(values: UpsertTestStepInput): Promise<void> {
    const now = new Date();
    await this.stepModel.upsert({
      suiteId: values.suiteId,
      endpointId: values.endpointId,
      stepOrder: values.stepOrder,
      name: values.name,
      inputMode: values.inputMode ?? 'DEFAULT',
      method: values.method,
      pathTemplate: values.pathTemplate,
      defaultHeaders: values.defaultHeaders ?? {},
      defaultPayload: values.defaultPayload ?? {},
      configSchema: values.configSchema ?? {},
      extractors: values.extractors ?? {},
      assertions: values.assertions ?? { expectedStatusCodes: [200, 201] },
      continueOnFailure: values.continueOnFailure ?? false,
      cleanupRequired: values.cleanupRequired ?? false,
      createdAtValue: now,
      updatedAtValue: now,
    } as never);
  }

  async listTestSuites(query: SystemsSuiteQueryDto) {
    const where: WhereOptions = {
      ...(query.module ? { module: query.module } : {}),
      ...(query.suiteType ? { suiteType: query.suiteType } : {}),
      ...(query.enabled !== undefined ? { isEnabled: query.enabled } : {}),
    } as WhereOptions;
    const result = await this.suiteModel.findAndCountAll({
      where,
      order: [['code', 'ASC']],
      limit: query.limit,
      offset: toOffset(query),
    } as FindAndCountOptions);
    return { rows: result.rows, meta: buildPaginationMeta(query, result.count) };
  }

  findTestSuiteById(suiteId: string): Promise<SystemTestSuiteModel | null> {
    return this.suiteModel.findByPk(suiteId);
  }

  findTestStepsBySuite(suiteId: string): Promise<SystemTestStepModel[]> {
    return this.stepModel.findAll({ where: { suiteId }, order: [['stepOrder', 'ASC']] } as FindOptions);
  }

  createTestRun(values: CreateTestRunInput): Promise<SystemTestRunModel> {
    return this.runModel.create({
      suiteId: values.suiteId,
      environment: values.environment,
      triggeredBy: values.triggeredBy,
      status: values.status,
      startedAt: values.startedAt,
      finishedAt: null,
      durationMs: null,
      summary: values.summary,
      logsUrl: null,
      createdAtValue: values.startedAt,
      updatedAtValue: values.startedAt,
    } as never);
  }

  async finishTestRun(run: SystemTestRunModel, values: FinishTestRunInput): Promise<SystemTestRunModel> {
    run.status = values.status;
    run.finishedAt = values.finishedAt;
    run.durationMs = values.durationMs;
    run.summary = values.summary;
    run.updatedAtValue = values.finishedAt;
    return run.save();
  }

  createTestStepRun(values: CreateTestStepRunInput): Promise<SystemTestStepRunModel> {
    return this.stepRunModel.create({
      testRunId: values.testRunId,
      stepId: values.stepId,
      status: values.status,
      requestPayloadSanitized: values.requestPayloadSanitized,
      responseBodySanitized: values.responseBodySanitized,
      statusCode: values.statusCode,
      durationMs: values.durationMs,
      errorMessage: values.errorMessage,
      createdAtValue: values.createdAt,
    } as never);
  }

  async listTestRuns(query: SystemsRunsQueryDto) {
    const where: WhereOptions = {
      ...(query.suiteId ? { suiteId: query.suiteId } : {}),
      ...(query.status ? { status: query.status } : {}),
      ...(query.environment ? { environment: query.environment } : {}),
    } as WhereOptions;
    const result = await this.runModel.findAndCountAll({
      where,
      order: [['createdAtValue', 'DESC']],
      limit: query.limit,
      offset: toOffset(query),
    } as FindAndCountOptions);
    return { rows: result.rows, meta: buildPaginationMeta(query, result.count) };
  }

  findTestRunById(runId: string): Promise<SystemTestRunModel | null> {
    return this.runModel.findByPk(runId);
  }

  findStepRunsByRun(runId: string): Promise<SystemTestStepRunModel[]> {
    return this.stepRunModel.findAll({ where: { testRunId: runId }, order: [['id', 'ASC']] } as FindOptions);
  }
}
