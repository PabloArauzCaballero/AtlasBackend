import { beforeAll, describe, expect, it, jest } from '@jest/globals';
import { Test } from '@nestjs/testing';
import type { OpenAPIObject } from '@nestjs/swagger';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { SchemaManagementController } from '../../../src/modules/schema-management/schema-management.controller.js';
import { SchemaManagementService } from '../../../src/modules/schema-management/services/schema-management.service.js';
import { InternalPortalController } from '../../../src/modules/internal-portal/internal-portal.controller.js';
import { InternalPortalService } from '../../../src/modules/internal-portal/internal-portal.service.js';
import { InternalAuthController } from '../../../src/modules/internal-users/internal-auth.controller.js';
import { InternalAuthService } from '../../../src/modules/internal-users/internal-auth.service.js';
import { InternalAccessCatalogController } from '../../../src/modules/internal-users/internal-access-catalog.controller.js';
import { InternalAccessCatalogService } from '../../../src/modules/internal-users/internal-access-catalog.service.js';
import { InternalUsersController } from '../../../src/modules/internal-users/internal-users.controller.js';
import { InternalUsersService } from '../../../src/modules/internal-users/internal-users.service.js';
import { InternalPermissionsGuard } from '../../../src/modules/internal-users/guards/internal-permissions.guard.js';
import { EventsController } from '../../../src/modules/events/events.controller.js';
import { EventsService } from '../../../src/modules/events/events.service.js';
import { RuntimeJobsController } from '../../../src/modules/runtime-jobs/runtime-jobs.controller.js';
import { RuntimeJobsService } from '../../../src/modules/runtime-jobs/runtime-jobs.service.js';
import { HealthController } from '../../../src/modules/health/health.controller.js';
import { getConnectionToken } from '@nestjs/sequelize';
import { JwtAuthGuard } from '../../../src/common/guards/jwt-auth.guard.js';
import { RolesGuard } from '../../../src/common/guards/roles.guard.js';

/**
 * ATLAS-OPENAPI: bloque final del retrofit — 8 controllers de 7 módulos distintos
 * (schema-management, internal-portal, internal-users x3, events, runtime-jobs, health), cada uno
 * montado en su propio prefijo de ruta. Valida que no haya colisiones y que cada operación tenga
 * summary.
 */
describe('final block — OpenAPI document generation (8 controllers, 7 modules)', () => {
  let document: OpenAPIObject;

  async function buildDocument() {
    const moduleRef = await Test.createTestingModule({
      controllers: [
        SchemaManagementController,
        InternalPortalController,
        InternalAuthController,
        InternalAccessCatalogController,
        InternalUsersController,
        EventsController,
        RuntimeJobsController,
        HealthController,
      ],
      providers: [
        {
          provide: SchemaManagementService,
          useValue: {
            listSchemaVersions: jest.fn(),
            getSchemaVersion: jest.fn(),
            listSchemaTables: jest.fn(),
            getSchemaTable: jest.fn(),
            proposeNewTable: jest.fn(),
            listSchemaChangeLog: jest.fn(),
            approveSchemaChange: jest.fn(),
          },
        },
        {
          provide: InternalPortalService,
          useValue: {
            listBusinessTerms: jest.fn(),
            getBusinessTerm: jest.fn(),
            listExports: jest.fn(),
            getExport: jest.fn(),
            listDataQualityRules: jest.fn(),
            getDataQualityRule: jest.fn(),
            runDataQualityRule: jest.fn(),
            getGovernancePolicy: jest.fn(),
            updateGovernancePolicy: jest.fn(),
            getLineage: jest.fn(),
            getLineageNode: jest.fn(),
            getLineageImpact: jest.fn(),
            listAlerts: jest.fn(),
            acknowledgeAlert: jest.fn(),
            listJobs: jest.fn(),
            getJob: jest.fn(),
            retryJob: jest.fn(),
            cancelJob: jest.fn(),
            getReleaseReadiness: jest.fn(),
            listReports: jest.fn(),
            getReport: jest.fn(),
            runReport: jest.fn(),
            listReportSnapshots: jest.fn(),
            search: jest.fn(),
          },
        },
        { provide: InternalAuthService, useValue: { login: jest.fn(), refresh: jest.fn(), logout: jest.fn() } },
        {
          provide: InternalAccessCatalogService,
          useValue: { listRoles: jest.fn(), getRole: jest.fn(), listPermissions: jest.fn() },
        },
        {
          provide: InternalUsersService,
          useValue: {
            getMyProfile: jest.fn(),
            createUser: jest.fn(),
            listUsers: jest.fn(),
            getUser: jest.fn(),
            updateUser: jest.fn(),
            replaceRoles: jest.fn(),
          },
        },
        { provide: InternalPermissionsGuard, useValue: { canActivate: () => true } },
        {
          provide: EventsService,
          useValue: {
            listDefinitions: jest.fn(),
            listEvents: jest.fn(),
            getEvent: jest.fn(),
            publishFromDto: jest.fn(),
            retryEvent: jest.fn(),
            cancelEvent: jest.fn(),
          },
        },
        {
          provide: RuntimeJobsService,
          useValue: {
            processOutbox: jest.fn(),
            processEvents: jest.fn(),
            expireStaleSessions: jest.fn(),
            applyRetentionPolicies: jest.fn(),
            recalculateDataQuality: jest.fn(),
          },
        },
        { provide: getConnectionToken(), useValue: { authenticate: jest.fn() } },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(RolesGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(InternalPermissionsGuard)
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

  it('documents a representative sample of paths across all 8 controllers without collisions', () => {
    const paths = Object.keys(document.paths);
    expect(paths).toEqual(
      expect.arrayContaining([
        '/operations/schema/versions',
        '/internal/business-metadata/glossary',
        '/internal/auth/login',
        '/internal/roles',
        '/internal/users',
        '/operations/events',
        '/operations/jobs/process-outbox',
        '/health',
      ]),
    );
  });

  it('every operation across all 8 controllers has a summary (no gaps left in the retrofit)', () => {
    let total = 0;
    for (const [path, methods] of Object.entries(document.paths)) {
      for (const [method, operation] of Object.entries(methods as Record<string, { summary?: string }>)) {
        total += 1;
        if (!operation.summary) throw new Error(`${method.toUpperCase()} ${path} is missing @ApiOperation summary`);
      }
    }
    expect(total).toBeGreaterThanOrEqual(45);
  });

  it('derives the publishEvent body schema (eventCode, aggregateType, etc.) from Zod', () => {
    const body = document.paths['/operations/events']?.post?.requestBody as {
      content: { 'application/json': { schema: Record<string, unknown> } };
    };
    expect((body.content['application/json'].schema.properties as Record<string, unknown>).eventCode).toBeDefined();
  });

  it('documents glossary search/pagination and its business-term response shape', () => {
    const operation = document.paths['/internal/business-metadata/glossary']?.get;
    const parameterNames = operation?.parameters?.map((parameter) => ('$ref' in parameter ? parameter.$ref : parameter.name));
    expect(parameterNames).toEqual(expect.arrayContaining(['q', 'page', 'limit', 'pageSize']));

    const response = operation?.responses?.['200'] as {
      content: { 'application/json': { schema: { properties: Record<string, unknown> } } };
    };
    expect(response.content['application/json'].schema.properties).toEqual(
      expect.objectContaining({ items: expect.any(Object), meta: expect.any(Object) }),
    );
  });

  it('documents glossary term details and the not-found contract', () => {
    const operation = document.paths['/internal/business-metadata/terms/{termId}']?.get;
    expect(operation?.responses?.['404']).toBeDefined();
    const response = operation?.responses?.['200'] as {
      content: { 'application/json': { schema: { properties: Record<string, unknown> } } };
    };
    expect(response.content['application/json'].schema.properties).toEqual(
      expect.objectContaining({
        synonyms: expect.any(Object),
        restrictions: expect.any(Object),
        relations: expect.any(Object),
        audit: expect.any(Object),
      }),
    );
  });
});
