import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { AuthenticatedUser } from '../../common/types/auth.types.js';
import { mapTestRun, mapTestStepRun } from './systems-ops.mapper.js';
import { RunTestSuiteDto } from './systems-ops.schemas.js';
import { SystemsTestExecutionRepository } from './systems-test-execution.repository.js';
import { sanitizeForSystemsOps } from './systems-sanitizer.js';
import { SystemTestStepModel } from '../../database/models/index.js';
import { SystemsTestAssertionService } from './systems-test-assertion.service.js';
import { SystemsTestHttpClientService } from './systems-test-http-client.service.js';
import { SystemsTestTemplateContext, SystemsTestTemplateService } from './systems-test-template.service.js';
import { readJsonPath } from './systems-json-path.util.js';
import { assertHostAllowed, SystemTestEnvironment } from './systems-test-url-policy.util.js';
import { systemsTenantScope } from './systems-tenant-scope.util.js';

type StepExecution = {
  status: 'PASSED' | 'FAILED';
  statusCode: number | null;
  responseBody: unknown;
  requestSummary: Record<string, unknown>;
  errorMessage: string | null;
  durationMs: number;
};

function actorIdentifier(user: AuthenticatedUser): string | null {
  return user.internalUserId ?? user.platformUserId ?? user.sub ?? null;
}

/**
 * ATLAS-AUDIT (auditoría #16, `systems-ops`): antes de este cambio, `assertRealRunCanExecute`
 * solo restringía el host de `baseUrl` cuando `environment === 'LOCAL'` — para `STAGING` y
 * `PRODUCTION_READONLY` cualquier rol de `SYSTEMS_OPS_ROLES` (incluido `readonly_auditor`) podía
 * ejecutar un run real (`dryRun: false`) con un `baseUrl` completamente arbitrario, causando que
 * el backend hiciera una petición HTTP saliente real a esa URL (SSRF). Este chequeo bloquea los
 * blancos más peligrosos (metadata de nube, rangos privados/loopback/link-local) para cualquier
 * ambiente que no sea `LOCAL`. No es DNS-rebinding-safe (valida el hostname/IP literal de la URL,
 * no la IP a la que realmente resuelve `fetch` en el momento de la petición) — cerrar eso del
 * todo requiere una lista blanca de hosts de confianza por ambiente, una decisión de
 * configuración que queda fuera del alcance de esta corrección puntual.
 */
function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function asStringRecord(value: unknown): Record<string, string> {
  const record = asRecord(value);
  return Object.fromEntries(Object.entries(record).filter((entry): entry is [string, string] => typeof entry[1] === 'string'));
}

@Injectable()
export class SystemsTestRunnerService {
  constructor(
    private readonly repository: SystemsTestExecutionRepository,
    private readonly assertions: SystemsTestAssertionService,
    private readonly httpClient: SystemsTestHttpClientService,
    private readonly templates: SystemsTestTemplateService,
  ) {}

  async runSuite(suiteId: string, body: RunTestSuiteDto, user: AuthenticatedUser) {
    const suite = await this.repository.findTestSuiteById(suiteId);
    if (!suite) throw new NotFoundException('SYSTEM_TEST_SUITE_NOT_FOUND');
    if (!suite.isEnabled) throw new BadRequestException('SYSTEM_TEST_SUITE_DISABLED');
    this.assertEnvironmentAllowed(suite.environmentScope, body.environment);
    this.assertProductionSafe(suite.isSafeForProduction, body.environment, body.dryRun);
    this.assertRealRunCanExecute(body);

    const steps = await this.repository.findTestStepsBySuite(suiteId);
    if (steps.length === 0) throw new BadRequestException('SYSTEM_TEST_SUITE_HAS_NO_STEPS');
    if (steps.length > 50) throw new BadRequestException('SYSTEM_TEST_SUITE_EXCEEDS_MAX_STEPS');
    const startedAt = new Date();
    const run = await this.repository.createTestRun({
      tenantId: systemsTenantScope(user),
      suiteId,
      environment: body.environment,
      triggeredBy: actorIdentifier(user),
      status: 'RUNNING',
      startedAt,
      summary: { dryRun: this.isDryRun(body), totalSteps: steps.length, timeoutMs: body.timeoutMs },
    });

    try {
      const context: Record<string, unknown> = {};
      let lastResponse: unknown = {};
      let passed = 0;
      let failed = 0;
      let stopped = false;

      for (const step of steps) {
        if (stopped) {
          await this.createSkippedStepRun(String(run.id), step);
          continue;
        }

        const executed = await this.executeStepSafely(step, body, { config: body.config, context, last: lastResponse });
        await this.repository.createTestStepRun({
          testRunId: String(run.id),
          stepId: String(step.id),
          status: executed.status,
          requestPayloadSanitized: sanitizeForSystemsOps(executed.requestSummary),
          responseBodySanitized: sanitizeForSystemsOps(executed.responseBody),
          statusCode: executed.statusCode,
          durationMs: executed.durationMs,
          errorMessage: executed.errorMessage,
          createdAt: new Date(),
        });

        if (executed.status === 'PASSED') {
          passed += 1;
          lastResponse = executed.responseBody;
          this.applyExtractors(context, step.extractors, executed.responseBody);
        } else {
          failed += 1;
          stopped = !step.continueOnFailure;
        }
      }

      const skipped = steps.length - passed - failed;
      const finishedAt = new Date();
      const status = failed > 0 ? 'FAILED' : 'PASSED';
      const updated = await this.repository.finishTestRun(run, {
        status,
        finishedAt,
        durationMs: finishedAt.getTime() - startedAt.getTime(),
        summary: {
          dryRun: this.isDryRun(body),
          totalSteps: steps.length,
          passed,
          failed,
          skipped,
          extractedContextKeys: Object.keys(context).sort(),
        },
      });
      const stepRuns = await this.repository.findStepRunsByRun(String(run.id));
      return { run: mapTestRun(updated), steps: stepRuns.map(mapTestStepRun) };
    } catch (error) {
      const finishedAt = new Date();
      try {
        await this.repository.finishTestRun(run, {
          status: 'FAILED',
          finishedAt,
          durationMs: finishedAt.getTime() - startedAt.getTime(),
          summary: { dryRun: this.isDryRun(body), totalSteps: steps.length, infrastructureFailure: true },
        });
      } catch {
        // Se conserva el error original; un reconciliador también cierra runs RUNNING antiguos.
      }
      throw error;
    }
  }

  private async executeStepSafely(
    step: SystemTestStepModel,
    body: RunTestSuiteDto,
    templateContext: SystemsTestTemplateContext,
  ): Promise<StepExecution> {
    const startedAt = Date.now();
    try {
      return await this.executeStep(step, body, templateContext);
    } catch (error) {
      return {
        status: 'FAILED',
        statusCode: null,
        responseBody: {},
        requestSummary: { method: step.method, path: step.pathTemplate, failedBeforeHttp: true },
        errorMessage: error instanceof Error ? error.message : 'unknown_error',
        durationMs: Date.now() - startedAt,
      };
    }
  }

  private async executeStep(
    step: SystemTestStepModel,
    body: RunTestSuiteDto,
    templateContext: SystemsTestTemplateContext,
  ): Promise<StepExecution> {
    const startedAt = Date.now();
    const resolvedContext = { ...templateContext, config: this.configForStep(step, templateContext.config) };
    const resolvedPath = this.templates.resolveString(step.pathTemplate, resolvedContext);
    if (typeof resolvedPath !== 'string') throw new BadRequestException('SYSTEM_TEST_PATH_TEMPLATE_MUST_RESOLVE_TO_STRING');
    const resolvedHeaders = asStringRecord(this.templates.resolveValue({ ...body.headers, ...step.defaultHeaders }, resolvedContext));
    const resolvedPayload = this.templates.resolveValue(this.payloadForStep(step, resolvedContext.config), resolvedContext);

    if (this.isDryRun(body)) {
      return this.dryRunStep(step, resolvedPath, resolvedHeaders, resolvedPayload, Date.now() - startedAt);
    }

    const httpResponse = await this.httpClient.execute({
      baseUrl: body.baseUrl!,
      path: resolvedPath,
      method: step.method,
      headers: resolvedHeaders,
      payload: resolvedPayload,
      timeoutMs: body.timeoutMs,
      environment: body.environment as SystemTestEnvironment,
    });
    const durationMs = Date.now() - startedAt;
    const assertionResult = this.assertions.evaluate({
      statusCode: httpResponse.statusCode,
      durationMs,
      responseBody: httpResponse.responseBody,
      assertions: step.assertions,
    });
    return {
      status: httpResponse.errorMessage === null && assertionResult.passed ? 'PASSED' : 'FAILED',
      statusCode: httpResponse.statusCode,
      responseBody: { body: httpResponse.responseBody, assertions: assertionResult.results },
      requestSummary: { method: step.method, path: resolvedPath, payload: resolvedPayload, headers: resolvedHeaders },
      errorMessage: httpResponse.errorMessage ?? this.firstFailedAssertion(assertionResult.results),
      durationMs,
    };
  }

  private dryRunStep(
    step: SystemTestStepModel,
    resolvedPath: string,
    resolvedHeaders: Record<string, string>,
    resolvedPayload: unknown,
    durationMs: number,
  ): StepExecution {
    return {
      status: 'PASSED',
      statusCode: null,
      responseBody: { dryRun: true, message: 'Step resolved without external HTTP execution.', assertions: step.assertions },
      requestSummary: { method: step.method, path: resolvedPath, payload: resolvedPayload, headers: resolvedHeaders, dryRun: true },
      errorMessage: null,
      durationMs,
    };
  }

  private payloadForStep(step: SystemTestStepModel, runConfig: Record<string, unknown>): Record<string, unknown> {
    const stepConfig = asRecord(runConfig[`step_${step.stepOrder}`] ?? runConfig[step.name] ?? {});
    if (step.inputMode === 'CONFIGURABLE') return { ...step.defaultPayload, ...stepConfig };
    return step.defaultPayload;
  }

  private configForStep(step: SystemTestStepModel, runConfig: Record<string, unknown>): Record<string, unknown> {
    return { ...this.defaultsFromConfigSchema(step.configSchema), ...runConfig };
  }

  private defaultsFromConfigSchema(configSchema: Record<string, unknown>): Record<string, unknown> {
    const output: Record<string, unknown> = {};
    for (const [key, definition] of Object.entries(configSchema)) {
      const defaultValue = asRecord(definition)['default'];
      if (defaultValue !== undefined) output[key] = defaultValue;
    }
    return output;
  }

  private applyExtractors(context: Record<string, unknown>, extractors: Record<string, unknown>, responseBody: unknown): void {
    const map = asRecord(extractors);
    for (const [key, path] of Object.entries(map)) {
      if (typeof path !== 'string') continue;
      const result = readJsonPath(responseBody, path);
      if (result.found) context[key] = result.value;
    }
  }

  private async createSkippedStepRun(testRunId: string, step: SystemTestStepModel): Promise<void> {
    await this.repository.createTestStepRun({
      testRunId,
      stepId: String(step.id),
      status: 'SKIPPED',
      requestPayloadSanitized: { method: step.method, path: step.pathTemplate, skipped: true },
      responseBodySanitized: { skipped: true, reason: 'Previous step failed and continueOnFailure=false.' },
      statusCode: null,
      durationMs: 0,
      errorMessage: null,
      createdAt: new Date(),
    });
  }

  private assertEnvironmentAllowed(scope: string[], environment: string): void {
    if (!scope.includes(environment) && !scope.includes(environment.toLowerCase())) {
      throw new ForbiddenException('SYSTEM_TEST_ENVIRONMENT_NOT_ALLOWED_FOR_SUITE');
    }
  }

  private assertProductionSafe(isSafeForProduction: boolean, environment: string, dryRun: boolean): void {
    if (environment === 'PRODUCTION_READONLY' && (!isSafeForProduction || !dryRun)) {
      throw new ForbiddenException('SYSTEM_TEST_PRODUCTION_EXECUTION_BLOCKED');
    }
  }

  private assertRealRunCanExecute(body: RunTestSuiteDto): void {
    if (this.isDryRun(body)) return;
    if (!body.baseUrl) throw new BadRequestException('SYSTEM_TEST_BASE_URL_REQUIRED_FOR_REAL_RUN');
    assertHostAllowed(new URL(body.baseUrl), body.environment as SystemTestEnvironment);
  }

  private isDryRun(body: RunTestSuiteDto): boolean {
    return body.dryRun || !body.baseUrl;
  }

  private firstFailedAssertion(results: { passed: boolean; name: string }[]): string | null {
    return results.find((result) => !result.passed)?.name ?? null;
  }
}
