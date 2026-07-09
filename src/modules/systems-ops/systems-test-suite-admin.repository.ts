import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { FindOptions } from 'sequelize';
import { SystemEndpointCatalogModel, SystemTestStepModel, SystemTestSuiteModel } from '../../database/models/index.js';
import {
  CreateTestStepDto,
  CreateTestSuiteDto,
  ReorderTestStepsDto,
  UpdateTestStepDto,
  UpdateTestSuiteDto,
} from './systems-ops.schemas.js';

function withDefaultDestructivePermission(input: CreateTestSuiteDto | UpdateTestSuiteDto): boolean | undefined {
  if (input.requiresDestructivePermission !== undefined) return input.requiresDestructivePermission;
  if (input.isSafeForProduction !== undefined) return !input.isSafeForProduction;
  return undefined;
}

@Injectable()
export class SystemsTestSuiteAdminRepository {
  constructor(
    @InjectModel(SystemEndpointCatalogModel) private readonly endpointModel: typeof SystemEndpointCatalogModel,
    @InjectModel(SystemTestSuiteModel) private readonly suiteModel: typeof SystemTestSuiteModel,
    @InjectModel(SystemTestStepModel) private readonly stepModel: typeof SystemTestStepModel,
  ) {}

  findEndpointById(endpointId: string): Promise<SystemEndpointCatalogModel | null> {
    return this.endpointModel.findByPk(endpointId);
  }

  findSuiteById(suiteId: string): Promise<SystemTestSuiteModel | null> {
    return this.suiteModel.findByPk(suiteId);
  }

  findStepById(stepId: string): Promise<SystemTestStepModel | null> {
    return this.stepModel.findByPk(stepId);
  }

  findStepsBySuite(suiteId: string): Promise<SystemTestStepModel[]> {
    return this.stepModel.findAll({ where: { suiteId }, order: [['stepOrder', 'ASC']] } as FindOptions);
  }

  createSuite(input: CreateTestSuiteDto, actorId: string | null): Promise<SystemTestSuiteModel> {
    const now = new Date();
    return this.suiteModel.create({
      code: input.code,
      name: input.name,
      description: input.description ?? null,
      module: input.module,
      suiteType: input.suiteType,
      executionMode: 'SYNC_OR_JOB',
      environmentScope: input.environmentScope,
      isEnabled: input.isEnabled,
      requiresSeedData: input.requiresSeedData,
      isSafeForProduction: input.isSafeForProduction,
      requiresDestructivePermission: input.requiresDestructivePermission ?? !input.isSafeForProduction,
      createdBy: actorId,
      createdAtValue: now,
      updatedAtValue: now,
    } as never);
  }

  async updateSuite(suite: SystemTestSuiteModel, input: UpdateTestSuiteDto): Promise<SystemTestSuiteModel> {
    const destructivePermission = withDefaultDestructivePermission(input);
    if (input.code !== undefined) suite.code = input.code;
    if (input.name !== undefined) suite.name = input.name;
    if (input.description !== undefined) suite.description = input.description ?? null;
    if (input.module !== undefined) suite.module = input.module;
    if (input.suiteType !== undefined) suite.suiteType = input.suiteType;
    if (input.environmentScope !== undefined) suite.environmentScope = input.environmentScope;
    if (input.isEnabled !== undefined) suite.isEnabled = input.isEnabled;
    if (input.requiresSeedData !== undefined) suite.requiresSeedData = input.requiresSeedData;
    if (input.isSafeForProduction !== undefined) suite.isSafeForProduction = input.isSafeForProduction;
    if (destructivePermission !== undefined) suite.requiresDestructivePermission = destructivePermission;
    suite.updatedAtValue = new Date();
    return suite.save();
  }

  createStep(suiteId: string, input: CreateTestStepDto): Promise<SystemTestStepModel> {
    const now = new Date();
    return this.stepModel.create({
      suiteId,
      endpointId: input.endpointId ?? null,
      stepOrder: input.stepOrder,
      name: input.name,
      inputMode: input.inputMode,
      method: input.method,
      pathTemplate: input.pathTemplate,
      defaultHeaders: input.defaultHeaders,
      defaultPayload: input.defaultPayload,
      configSchema: input.configSchema,
      extractors: input.extractors,
      assertions: input.assertions,
      continueOnFailure: input.continueOnFailure,
      cleanupRequired: input.cleanupRequired,
      createdAtValue: now,
      updatedAtValue: now,
    } as never);
  }

  async updateStep(step: SystemTestStepModel, input: UpdateTestStepDto): Promise<SystemTestStepModel> {
    if (input.endpointId !== undefined) step.endpointId = input.endpointId ?? null;
    if (input.stepOrder !== undefined) step.stepOrder = input.stepOrder;
    if (input.name !== undefined) step.name = input.name;
    if (input.inputMode !== undefined) step.inputMode = input.inputMode;
    if (input.method !== undefined) step.method = input.method;
    if (input.pathTemplate !== undefined) step.pathTemplate = input.pathTemplate;
    if (input.defaultHeaders !== undefined) step.defaultHeaders = input.defaultHeaders;
    if (input.defaultPayload !== undefined) step.defaultPayload = input.defaultPayload;
    if (input.configSchema !== undefined) step.configSchema = input.configSchema;
    if (input.extractors !== undefined) step.extractors = input.extractors;
    if (input.assertions !== undefined) step.assertions = input.assertions;
    if (input.continueOnFailure !== undefined) step.continueOnFailure = input.continueOnFailure;
    if (input.cleanupRequired !== undefined) step.cleanupRequired = input.cleanupRequired;
    step.updatedAtValue = new Date();
    return step.save();
  }

  async reorderSteps(suiteId: string, input: ReorderTestStepsDto): Promise<SystemTestStepModel[]> {
    const currentSteps = await this.findStepsBySuite(suiteId);
    const currentIds = new Set(currentSteps.map((step) => String(step.id)));
    const requestedIds = input.steps.map((step) => step.stepId);
    const unknownIds = requestedIds.filter((stepId) => !currentIds.has(stepId));
    if (unknownIds.length > 0) {
      throw new Error(`SYSTEM_TEST_STEP_NOT_IN_SUITE:${unknownIds.join(',')}`);
    }

    const uniqueOrders = new Set(input.steps.map((step) => step.stepOrder));
    if (uniqueOrders.size !== input.steps.length) {
      throw new Error('SYSTEM_TEST_STEP_DUPLICATED_ORDER');
    }

    const byId = new Map(currentSteps.map((step) => [String(step.id), step]));
    for (const item of input.steps) {
      const step = byId.get(item.stepId);
      if (!step) continue;
      step.stepOrder = item.stepOrder;
      step.updatedAtValue = new Date();
      await step.save();
    }
    return this.findStepsBySuite(suiteId);
  }
}
