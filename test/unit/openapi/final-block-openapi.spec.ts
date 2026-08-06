import { beforeAll, describe, expect, it } from '@jest/globals';
import { asyncMock } from '../../support/jest-mocks.js';
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
import { RuntimeMaintenanceJobsService } from '../../../src/modules/runtime-jobs/runtime-maintenance-jobs.service.js';
import { HealthController } from '../../../src/modules/health/health.controller.js';
import { getConnectionToken } from '@nestjs/sequelize';
import { REDIS_CLIENT } from '../../../src/common/redis/redis.module.js';
import { GracefulShutdownService } from '../../../src/common/lifecycle/graceful-shutdown.service.js';
import { ReadQueryService } from '../../../src/common/database/read-query.service.js';
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
            listSchemaVersions: asyncMock(),
            getSchemaVersion: asyncMock(),
            listSchemaTables: asyncMock(),
            getSchemaTable: asyncMock(),
            proposeNewTable: asyncMock(),
            listSchemaChangeLog: asyncMock(),
            approveSchemaChange: asyncMock(),
          },
        },
        {
          provide: InternalPortalService,
          useValue: {
            listBusinessTerms: asyncMock(),
            getBusinessTerm: asyncMock(),
            listExports: asyncMock(),
            getExport: asyncMock(),
            listDataQualityRules: asyncMock(),
            getDataQualityRule: asyncMock(),
            runDataQualityRule: asyncMock(),
            getGovernancePolicy: asyncMock(),
            updateGovernancePolicy: asyncMock(),
            getLineage: asyncMock(),
            getLineageNode: asyncMock(),
            getLineageImpact: asyncMock(),
            listAlerts: asyncMock(),
            acknowledgeAlert: asyncMock(),
            listJobs: asyncMock(),
            getJob: asyncMock(),
            retryJob: asyncMock(),
            cancelJob: asyncMock(),
            getReleaseReadiness: asyncMock(),
            listReports: asyncMock(),
            getReport: asyncMock(),
            runReport: asyncMock(),
            listReportSnapshots: asyncMock(),
            search: asyncMock(),
          },
        },
        { provide: InternalAuthService, useValue: { login: asyncMock(), refresh: asyncMock(), logout: asyncMock() } },
        {
          provide: InternalAccessCatalogService,
          useValue: { listRoles: asyncMock(), getRole: asyncMock(), listPermissions: asyncMock() },
        },
        {
          provide: InternalUsersService,
          useValue: {
            getMyProfile: asyncMock(),
            createUser: asyncMock(),
            listUsers: asyncMock(),
            getUser: asyncMock(),
            updateUser: asyncMock(),
            replaceRoles: asyncMock(),
          },
        },
        { provide: InternalPermissionsGuard, useValue: { canActivate: () => true } },
        {
          provide: EventsService,
          useValue: {
            listDefinitions: asyncMock(),
            listEvents: asyncMock(),
            getEvent: asyncMock(),
            publishFromDto: asyncMock(),
            retryEvent: asyncMock(),
            cancelEvent: asyncMock(),
          },
        },
        {
          provide: RuntimeJobsService,
          useValue: {
            processOutbox: asyncMock(),
            processEvents: asyncMock(),
            expireStaleSessions: asyncMock(),
            applyRetentionPolicies: asyncMock(),
            recalculateDataQuality: asyncMock(),
          },
        },
        // Los dos jobs de saneamiento viven en su propio servicio (extraídos para no seguir
        // engordando `runtime-jobs.service.ts`, ya muy por encima del límite de tamaño).
        {
          provide: RuntimeMaintenanceJobsService,
          useValue: { retryStuckNotifications: asyncMock(), purgeIdempotencyKeys: asyncMock(), reclaimStuckEvents: asyncMock() },
        },
        { provide: getConnectionToken(), useValue: { authenticate: asyncMock() } },
        // HealthController ahora inyecta REDIS_CLIENT (readiness verifica Redis si está configurado).
        { provide: REDIS_CLIENT, useValue: null },
        // ...y GracefulShutdownService: durante el drenado por SIGTERM, readiness responde 503 para
        // que el balanceador retire la instancia antes de que se cierre (hallazgo A-07).
        { provide: GracefulShutdownService, useValue: { isShuttingDown: () => false } },
        // ...y ReadQueryService: readiness reporta también el estado del pool de LECTURA dedicado.
        { provide: ReadQueryService, useValue: { getConnection: () => ({ authenticate: asyncMock() }) } },
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

    const response = operation?.responses?.['200'] as unknown as {
      content: { 'application/json': { schema: { properties: Record<string, unknown> } } };
    };
    expect(response.content['application/json'].schema.properties).toEqual(
      expect.objectContaining({ items: expect.any(Object), meta: expect.any(Object) }),
    );
  });

  it('documents glossary term details and the not-found contract', () => {
    const operation = document.paths['/internal/business-metadata/terms/{termId}']?.get;
    expect(operation?.responses?.['404']).toBeDefined();
    const response = operation?.responses?.['200'] as unknown as {
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
