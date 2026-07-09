import { beforeAll, describe, expect, it, jest } from '@jest/globals';
import { Test } from '@nestjs/testing';
import type { OpenAPIObject } from '@nestjs/swagger';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { SystemsActionLogController } from '../../../src/modules/systems-ops/systems-action-log.controller.js';
import { SystemsCatalogController } from '../../../src/modules/systems-ops/systems-catalog.controller.js';
import { SystemsReviewController } from '../../../src/modules/systems-ops/systems-review.controller.js';
import { SystemsStressController } from '../../../src/modules/systems-ops/systems-stress.controller.js';
import { SystemsTestController } from '../../../src/modules/systems-ops/systems-test.controller.js';
import { SystemsActionLogQueryService } from '../../../src/modules/systems-ops/systems-action-log-query.service.js';
import { SystemsCatalogQueryService } from '../../../src/modules/systems-ops/systems-catalog-query.service.js';
import { SystemsToolInferenceService } from '../../../src/modules/systems-ops/systems-tool-inference.service.js';
import { SystemsReviewService } from '../../../src/modules/systems-ops/systems-review.service.js';
import { SystemsStressProfileService } from '../../../src/modules/systems-ops/systems-stress-profile.service.js';
import { SystemsStressRunService } from '../../../src/modules/systems-ops/systems-stress-run.service.js';
import { SystemsTestQueryService } from '../../../src/modules/systems-ops/systems-test-query.service.js';
import { SystemsTestSuiteAdminService } from '../../../src/modules/systems-ops/systems-test-suite-admin.service.js';
import { JwtAuthGuard } from '../../../src/common/guards/jwt-auth.guard.js';
import { RolesGuard } from '../../../src/common/guards/roles.guard.js';

/**
 * ATLAS-OPENAPI: `systems-ops` es el segundo módulo con más controllers (5). Este test genera el
 * documento completo con los 5 controllers montados juntos en el mismo prefijo `systems` para
 * detectar colisiones de ruta/operación entre ellos.
 */
describe('systems-ops — OpenAPI document generation (5 controllers)', () => {
  let document: OpenAPIObject;

  async function buildDocument() {
    const actionLogServiceMock = {
      listActionLogs: jest.fn(),
      getActionLogsByRequest: jest.fn(),
    };
    const catalogServiceMock = {
      getDashboard: jest.fn(),
      listEndpoints: jest.fn(),
      getEndpoint: jest.fn(),
      discoverEndpoints: jest.fn(),
      refreshCatalogSeed: jest.fn(),
      listTools: jest.fn(),
      getTool: jest.fn(),
      listDataEntities: jest.fn(),
      getDataEntity: jest.fn(),
      updateDataEntityMetadata: jest.fn(),
      getImpactByEndpoint: jest.fn(),
      getImpactByTable: jest.fn(),
      getToolsHealth: jest.fn(),
      getStressMatrix: jest.fn(),
    };
    const toolInferenceServiceMock = { infer: jest.fn() };
    const reviewServiceMock = {
      getReviewQueue: jest.fn(),
      reviewEndpoint: jest.fn(),
      reviewToolRequirement: jest.fn(),
      reviewDataEntity: jest.fn(),
      reviewDataImpact: jest.fn(),
      reviewFieldImpact: jest.fn(),
      reviewDataColumn: jest.fn(),
    };
    const stressProfileServiceMock = {
      listStressProfiles: jest.fn(),
      getStressProfile: jest.fn(),
      upsertStressProfile: jest.fn(),
      getStressMatrix: jest.fn(),
    };
    const stressRunServiceMock = {
      queueStressRun: jest.fn(),
      listStressRuns: jest.fn(),
    };
    const testQueryServiceMock = {
      listTestSuites: jest.fn(),
      getTestSuite: jest.fn(),
      runTestSuite: jest.fn(),
      listTestRuns: jest.fn(),
      getTestRun: jest.fn(),
    };
    const testSuiteAdminServiceMock = {
      createSuite: jest.fn(),
      updateSuite: jest.fn(),
      createStep: jest.fn(),
      updateStep: jest.fn(),
      reorderSteps: jest.fn(),
    };

    const moduleRef = await Test.createTestingModule({
      controllers: [
        SystemsActionLogController,
        SystemsCatalogController,
        SystemsReviewController,
        SystemsStressController,
        SystemsTestController,
      ],
      providers: [
        { provide: SystemsActionLogQueryService, useValue: actionLogServiceMock },
        { provide: SystemsCatalogQueryService, useValue: catalogServiceMock },
        { provide: SystemsToolInferenceService, useValue: toolInferenceServiceMock },
        { provide: SystemsReviewService, useValue: reviewServiceMock },
        { provide: SystemsStressProfileService, useValue: stressProfileServiceMock },
        { provide: SystemsStressRunService, useValue: stressRunServiceMock },
        { provide: SystemsTestQueryService, useValue: testQueryServiceMock },
        { provide: SystemsTestSuiteAdminService, useValue: testSuiteAdminServiceMock },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(RolesGuard)
      .useValue({ canActivate: () => true })
      .compile();

    const app = moduleRef.createNestApplication();
    await app.init();
    const config = new DocumentBuilder().setTitle('Atlas API Test').setVersion('test').build();
    const doc = SwaggerModule.createDocument(app, config);
    await app.close();
    return doc;
  }

  beforeAll(async () => {
    document = await buildDocument();
  }, 30_000);

  it('documents a representative sample of paths across all 5 controllers without collisions', () => {
    const paths = Object.keys(document.paths);
    expect(paths).toEqual(
      expect.arrayContaining([
        '/systems/action-logs',
        '/systems/endpoints',
        '/systems/review-queue',
        '/systems/stress-profiles',
        '/systems/test-suites',
      ]),
    );
  });

  it('every operation across all 5 controllers has a summary (no gaps left in the retrofit)', () => {
    let total = 0;
    for (const [path, methods] of Object.entries(document.paths)) {
      for (const [method, operation] of Object.entries(methods as Record<string, { summary?: string }>)) {
        total += 1;
        if (!operation.summary) throw new Error(`${method.toUpperCase()} ${path} is missing @ApiOperation summary`);
      }
    }
    expect(total).toBeGreaterThanOrEqual(27);
  });

  it('derives the upsertStressProfile body schema (targetRps, durationSeconds, etc.) from Zod', () => {
    const body = document.paths['/systems/stress-profiles']?.post?.requestBody as {
      content: { 'application/json': { schema: Record<string, unknown> } };
    };
    expect((body.content['application/json'].schema.properties as Record<string, unknown>).targetRps).toBeDefined();
  });
});
