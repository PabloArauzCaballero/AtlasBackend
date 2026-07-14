import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { AuthenticatedUser } from '../../common/types/auth.types.js';
import { actorId } from '../../common/utils/auth/actor.util.js';
import { mapTestStep, mapTestSuite } from './systems-ops.mapper.js';
import {
  CreateTestStepDto,
  CreateTestSuiteDto,
  ReorderTestStepsDto,
  UpdateTestStepDto,
  UpdateTestSuiteDto,
} from './systems-ops.schemas.js';
import { SystemsTestSuiteAdminRepository } from './systems-test-suite-admin.repository.js';

@Injectable()
export class SystemsTestSuiteAdminService {
  constructor(private readonly repository: SystemsTestSuiteAdminRepository) {}

  async createSuite(input: CreateTestSuiteDto, user: AuthenticatedUser) {
    this.assertProductionScopeIsExplicitlySafe(input.environmentScope, input.isSafeForProduction);
    try {
      const suite = await this.repository.createSuite(input, actorId(user));
      return { suite: mapTestSuite(suite), steps: [] };
    } catch (error) {
      this.handlePersistenceError(error, 'SYSTEM_TEST_SUITE_CREATE_FAILED');
    }
  }

  async updateSuite(suiteId: string, input: UpdateTestSuiteDto) {
    const suite = await this.repository.findSuiteById(suiteId);
    if (!suite) throw new NotFoundException('SYSTEM_TEST_SUITE_NOT_FOUND');
    this.assertProductionScopeIsExplicitlySafe(
      input.environmentScope ?? suite.environmentScope,
      input.isSafeForProduction ?? suite.isSafeForProduction,
    );
    try {
      const updated = await this.repository.updateSuite(suite, input);
      const steps = await this.repository.findStepsBySuite(suiteId);
      return { suite: mapTestSuite(updated), steps: steps.map(mapTestStep) };
    } catch (error) {
      this.handlePersistenceError(error, 'SYSTEM_TEST_SUITE_UPDATE_FAILED');
    }
  }

  async createStep(suiteId: string, input: CreateTestStepDto) {
    const suite = await this.repository.findSuiteById(suiteId);
    if (!suite) throw new NotFoundException('SYSTEM_TEST_SUITE_NOT_FOUND');
    await this.assertEndpointBelongsToCatalog(input.endpointId ?? null);
    this.assertStepSafety(suite.isSafeForProduction, input);
    try {
      const step = await this.repository.createStep(suiteId, input);
      return mapTestStep(step);
    } catch (error) {
      this.handlePersistenceError(error, 'SYSTEM_TEST_STEP_CREATE_FAILED');
    }
  }

  async updateStep(suiteId: string, stepId: string, input: UpdateTestStepDto) {
    const [suite, step] = await Promise.all([this.repository.findSuiteById(suiteId), this.repository.findStepById(stepId)]);
    if (!suite) throw new NotFoundException('SYSTEM_TEST_SUITE_NOT_FOUND');
    if (!step || String(step.suiteId) !== suiteId) throw new NotFoundException('SYSTEM_TEST_STEP_NOT_FOUND');
    await this.assertEndpointBelongsToCatalog(input.endpointId ?? null);
    this.assertStepSafety(suite.isSafeForProduction, { ...mapTestStep(step), ...input } as CreateTestStepDto);
    try {
      return mapTestStep(await this.repository.updateStep(step, input));
    } catch (error) {
      this.handlePersistenceError(error, 'SYSTEM_TEST_STEP_UPDATE_FAILED');
    }
  }

  async reorderSteps(suiteId: string, input: ReorderTestStepsDto) {
    const suite = await this.repository.findSuiteById(suiteId);
    if (!suite) throw new NotFoundException('SYSTEM_TEST_SUITE_NOT_FOUND');
    try {
      const steps = await this.repository.reorderSteps(suiteId, input);
      return { items: steps.map(mapTestStep) };
    } catch (error) {
      if (error instanceof Error && error.message.startsWith('SYSTEM_TEST_STEP_NOT_IN_SUITE')) {
        throw new BadRequestException(error.message);
      }
      if (error instanceof Error && error.message === 'SYSTEM_TEST_STEP_DUPLICATED_ORDER') {
        throw new BadRequestException(error.message);
      }
      this.handlePersistenceError(error, 'SYSTEM_TEST_STEP_REORDER_FAILED');
    }
  }

  private async assertEndpointBelongsToCatalog(endpointId: string | null): Promise<void> {
    if (!endpointId) return;
    const endpoint = await this.repository.findEndpointById(endpointId);
    if (!endpoint) throw new BadRequestException('SYSTEM_TEST_STEP_ENDPOINT_NOT_FOUND');
  }

  private assertProductionScopeIsExplicitlySafe(environmentScope: string[], isSafeForProduction: boolean): void {
    if (environmentScope.includes('PRODUCTION_READONLY') && !isSafeForProduction) {
      throw new BadRequestException('PRODUCTION_READONLY_REQUIRES_SAFE_SUITE');
    }
  }

  private assertStepSafety(isSuiteSafeForProduction: boolean, input: Pick<CreateTestStepDto, 'method' | 'pathTemplate'>): void {
    if (!isSuiteSafeForProduction) return;
    const method = input.method.toUpperCase();
    if (!['GET', 'HEAD', 'OPTIONS'].includes(method)) {
      throw new BadRequestException('PRODUCTION_SAFE_SUITE_ONLY_ALLOWS_READONLY_METHODS');
    }
    if (/run|retry|delete|remove|cancel|approve|reject|resolve|seed|refresh|process/i.test(input.pathTemplate)) {
      throw new BadRequestException('PRODUCTION_SAFE_SUITE_PATH_LOOKS_MUTATING');
    }
  }

  private handlePersistenceError(error: unknown, fallbackCode: string): never {
    const message = error instanceof Error ? error.message : fallbackCode;
    if (/unique|duplicate/i.test(message)) throw new ConflictException('SYSTEM_TEST_SUITE_OR_STEP_ALREADY_EXISTS');
    throw new BadRequestException(fallbackCode);
  }
}
