import { Injectable, NotFoundException } from '@nestjs/common';
import { AuthenticatedUser } from '../../common/types/auth.types.js';
import { mapTestRun, mapTestStep, mapTestStepRun, mapTestSuite } from './systems-ops.mapper.js';
import { RunTestSuiteDto, SystemsRunsQueryDto, SystemsSuiteQueryDto } from './systems-ops.schemas.js';
import { SystemsTestExecutionRepository } from './systems-test-execution.repository.js';
import { SystemsTestRunnerService } from './systems-test-runner.service.js';

@Injectable()
export class SystemsTestQueryService {
  constructor(
    private readonly testRepository: SystemsTestExecutionRepository,
    private readonly testRunner: SystemsTestRunnerService,
  ) {}

  async listTestSuites(query: SystemsSuiteQueryDto) {
    const result = await this.testRepository.listTestSuites(query);
    return { items: result.rows.map(mapTestSuite), meta: result.meta };
  }

  async getTestSuite(suiteId: string) {
    const suite = await this.testRepository.findTestSuiteById(suiteId);
    if (!suite) throw new NotFoundException('SYSTEM_TEST_SUITE_NOT_FOUND');
    const steps = await this.testRepository.findTestStepsBySuite(suiteId);
    return { suite: mapTestSuite(suite), steps: steps.map(mapTestStep) };
  }

  runTestSuite(suiteId: string, body: RunTestSuiteDto, user: AuthenticatedUser) {
    return this.testRunner.runSuite(suiteId, body, user);
  }

  async listTestRuns(query: SystemsRunsQueryDto) {
    const result = await this.testRepository.listTestRuns(query);
    return { items: result.rows.map(mapTestRun), meta: result.meta };
  }

  async getTestRun(runId: string) {
    const run = await this.testRepository.findTestRunById(runId);
    if (!run) throw new NotFoundException('SYSTEM_TEST_RUN_NOT_FOUND');
    const steps = await this.testRepository.findStepRunsByRun(runId);
    return { run: mapTestRun(run), steps: steps.map(mapTestStepRun) };
  }
}
