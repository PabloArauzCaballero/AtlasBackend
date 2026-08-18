/**
 * @file Servicio de aplicación o dominio: ejecuta reglas y coordina dependencias.
 * @business Esta pieza hace observable y gobernable el propio backend para operaciones, QA y arquitectura.
 * @system descubre endpoints, cataloga impacto de datos, ejecuta pruebas controladas y expone salud y cobertura.
 */
import { ConflictException, Injectable } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/sequelize';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { QueryTypes } from 'sequelize';
import { Sequelize } from 'sequelize-typescript';
import { SYSTEM_TOOL_SEEDS } from './systems-ops.constants.js';
import { EndpointDiscoveryService } from './endpoint-discovery.service.js';
import { SystemsCatalogClassifierService } from './systems-catalog-classifier.service.js';
import { SystemsCatalogRepository } from './systems-catalog.repository.js';
import { SystemsStressProfileRepository } from './systems-stress-profile.repository.js';
import { SystemsTestExecutionRepository } from './systems-test-execution.repository.js';
import { CURATED_ENDPOINTS, STRESS_PROFILE_SEEDS } from './systems-seed-fixtures.js';
import { SystemJobRunModel } from '../../database/models/index.js';
import { AuthenticatedUser } from '../../common/types/auth.types.js';
import { actorId } from '../../common/utils/auth/actor.util.js';
import { systemsTenantScope } from './systems-tenant-scope.util.js';
import { pathExists } from './path-exists.util.js';
import { SystemsEndpointDocsService } from './systems-endpoint-docs.service.js';
import { SystemsSchemaIntrospectionService } from './systems-schema-introspection.service.js';

@Injectable()
export class SystemsCatalogSeedService {
  constructor(
    @InjectConnection() private readonly sequelize: Sequelize,
    private readonly catalogRepository: SystemsCatalogRepository,
    private readonly testRepository: SystemsTestExecutionRepository,
    private readonly stressRepository: SystemsStressProfileRepository,
    private readonly discovery: EndpointDiscoveryService,
    private readonly classifier: SystemsCatalogClassifierService,
    @InjectModel(SystemJobRunModel) private readonly jobRunModel: typeof SystemJobRunModel,
    // Las dos mitades pesadas del reseeding: reflejar el esquema real y leer la documentación.
    private readonly introspection: SystemsSchemaIntrospectionService,
    private readonly endpointDocs: SystemsEndpointDocsService,
  ) {}

  /** Refleja el esquema real de la base en el catálogo. Delegado en su propio servicio. */
  seedColumnsFromInformationSchema(): Promise<{ columns: number; relationships: number }> {
    return this.introspection.seedColumnsFromInformationSchema();
  }

  /** Qué tabla toca cada endpoint, según la documentación versionada. */
  seedImpactsFromDocs(): Promise<number> {
    return this.endpointDocs.seedImpactsFromDocs();
  }

  async refreshCatalog(
    input: { includeTools: boolean; includeDataEntities: boolean; includeEndpointSeeds: boolean },
    user: AuthenticatedUser,
  ) {
    const lockTransaction = await this.sequelize.transaction();
    const [lock] = await this.sequelize.query<{ acquired: boolean }>(
      `SELECT pg_try_advisory_xact_lock(hashtext('atlas_systems_catalog_refresh')) AS acquired`,
      { type: QueryTypes.SELECT, transaction: lockTransaction },
    );
    if (!lock?.acquired) {
      await lockTransaction.rollback();
      throw new ConflictException('SYSTEMS_CATALOG_REFRESH_ALREADY_RUNNING');
    }
    const startedAt = new Date();
    const job = await this.jobRunModel.create({
      tenantId: systemsTenantScope(user),
      jobCode: 'systems_catalog_refresh',
      status: 'running',
      startedAt,
      inputJson: input,
      resultJson: null,
      errorMessage: null,
      triggeredByType: 'user',
      triggeredById: actorId(user),
      createdAtValue: startedAt,
    } as never);
    const result = {
      tools: 0,
      dataEntities: 0,
      columns: 0,
      relationships: 0,
      endpointSeeds: 0,
      discoveredEndpoints: 0,
      impacts: 0,
      suites: 0,
      stressProfiles: 0,
    };
    try {
      if (input.includeTools) result.tools = await this.seedTools();
      if (input.includeDataEntities) {
        result.dataEntities = await this.seedDataEntitiesFromModels();
        const columnSeed = await this.seedColumnsFromInformationSchema();
        result.columns = columnSeed.columns;
        result.relationships = columnSeed.relationships;
      }
      if (input.includeEndpointSeeds) {
        result.endpointSeeds = await this.seedCuratedEndpoints();
        const discovered = await this.discovery.discoverAndMaybePersist(true);
        result.discoveredEndpoints = discovered.persisted;
        result.impacts = await this.seedImpactsFromDocs();
        result.suites = await this.seedSuites();
        result.stressProfiles = await this.seedStressProfiles();
      }
      job.status = 'succeeded';
      job.completedAt = new Date();
      job.resultJson = result;
      await job.save();
      await lockTransaction.commit();
      return { jobRunId: String(job.id), ...result };
    } catch (error) {
      job.status = 'failed';
      job.completedAt = new Date();
      job.resultJson = result;
      job.errorMessage = error instanceof Error ? error.message.slice(0, 2000) : 'unknown_error';
      await job.save().catch(() => undefined);
      await lockTransaction.rollback().catch(() => undefined);
      throw error;
    }
  }

  async seedTools(): Promise<number> {
    for (const seed of SYSTEM_TOOL_SEEDS) await this.catalogRepository.upsertTool(seed);
    return SYSTEM_TOOL_SEEDS.length;
  }

  async seedDataEntitiesFromModels(): Promise<number> {
    const modelDir = join(process.cwd(), 'src', 'database', 'models');
    if (!(await pathExists(modelDir))) return 0;
    const files = (await readdir(modelDir)).filter((file) => file.endsWith('.model.ts'));
    let count = 0;
    const seen = new Set<string>();
    for (const file of files) {
      const source = await readFile(join(modelDir, file), 'utf8');
      const tableName = source.match(/@Table\(\{\s*tableName:\s*['"]([^'"]+)['"]/s)?.[1];
      const modelName = source.match(/export\s+class\s+([A-Za-z0-9_]+)/)?.[1] ?? null;
      if (!tableName || seen.has(tableName)) continue;
      await this.catalogRepository.upsertDataEntity(this.classifier.classifyTable(tableName, modelName));
      seen.add(tableName);
      count += 1;
    }
    return count;
  }

  async seedCuratedEndpoints(): Promise<number> {
    for (const seed of CURATED_ENDPOINTS) await this.catalogRepository.upsertEndpoint(seed);
    return CURATED_ENDPOINTS.length;
  }

  async seedSuites(): Promise<number> {
    const smoke = await this.testRepository.upsertTestSuite({
      code: 'SMOKE_HEALTH_AND_DOCS',
      name: 'Smoke de salud y documentación',
      description: 'Verifica health y endpoints internos de solo lectura básicos.',
      module: 'systems',
      suiteType: 'SMOKE',
      environmentScope: ['LOCAL', 'STAGING', 'PRODUCTION_READONLY'],
      isSafeForProduction: true,
    });
    await this.testRepository.upsertTestStep({
      suiteId: String(smoke.id),
      endpointId: null,
      stepOrder: 1,
      name: 'Health',
      method: 'GET',
      pathTemplate: '/api/v1/health',
      extractors: { healthStatus: '$.body.status', databaseStatus: '$.body.database' },
      assertions: {
        expectedStatusCodes: [200],
        jsonPathExists: ['$.status', '$.service', '$.database', '$.timestamp'],
        jsonPathEquals: { '$.service': 'atlas-backend' },
        jsonPathType: { '$.uptime': 'number' },
        maxDurationMs: 2000,
      },
    });

    const operations = await this.testRepository.upsertTestSuite({
      code: 'OPERATIONS_WORK_QUEUE',
      name: 'Cola operativa',
      description: 'Verifica lectura interna de work queue para operaciones.',
      module: 'operations',
      suiteType: 'INTEGRATION',
      environmentScope: ['LOCAL', 'STAGING'],
    });
    const endpoint = await this.catalogRepository.findEndpointByMethodAndPath('GET', '/api/v1/operations/work-queue');
    await this.testRepository.upsertTestStep({
      suiteId: String(operations.id),
      endpointId: endpoint ? String(endpoint.id) : null,
      stepOrder: 1,
      name: 'Listar work queue',
      method: 'GET',
      pathTemplate: '/api/v1/operations/work-queue?queue={{config.queue}}&page=1&limit=20',
      inputMode: 'CONFIGURABLE',
      configSchema: { queue: { type: 'string', default: 'all' } },
      assertions: { expectedStatusCodes: [200], maxDurationMs: 2500 },
    });
    return 2;
  }

  async seedStressProfiles(): Promise<number> {
    let count = 0;
    for (const candidate of STRESS_PROFILE_SEEDS) {
      const endpoint = await this.catalogRepository.findEndpointByMethodAndPath(candidate.method, candidate.path);
      if (!endpoint) continue;
      await this.stressRepository.upsertStressProfile({
        endpointId: String(endpoint.id),
        code: `STRESS_${endpoint.code}`.slice(0, 180),
        name: candidate.name,
        targetRps: candidate.targetRps,
        durationSeconds: candidate.durationSeconds,
        concurrency: candidate.concurrency,
        environmentScope: ['LOCAL', 'STAGING'],
        maxErrorRate: 0.01,
        maxP95Ms: endpoint.riskLevel === 'CRITICAL' ? 1200 : 900,
        isEnabled: true,
        requiresApproval: true,
        status: 'ACTIVE',
        notes: 'Perfil inicial seguro. Ejecutar solo en local/staging hasta tener job runner aislado.',
        actorId: 'system_seed',
      });
      count += 1;
    }
    return count;
  }
}
