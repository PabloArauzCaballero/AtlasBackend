import { Injectable, NotFoundException } from '@nestjs/common';
import {
  mapDataEntity,
  mapDataField,
  mapDataImpact,
  mapDataRelationship,
  mapDomain,
  mapEndpoint,
  mapFieldImpact,
  mapTool,
  mapToolRequirement,
} from './systems-ops.mapper.js';
import { CatalogSeedRefreshDto, DiscoverEndpointsDto, SystemsListQueryDto } from './systems-ops.schemas.js';
import { EndpointDiscoveryService } from './endpoint-discovery.service.js';
import { SystemsCatalogSeedService } from './systems-catalog-seed.service.js';
import { SystemsHealthService } from './systems-health.service.js';
import { SystemsCatalogRepository } from './systems-catalog.repository.js';
import { SystemsDashboardRepository } from './systems-dashboard.repository.js';

@Injectable()
export class SystemsCatalogQueryService {
  constructor(
    private readonly catalogRepository: SystemsCatalogRepository,
    private readonly dashboardRepository: SystemsDashboardRepository,
    private readonly discovery: EndpointDiscoveryService,
    private readonly seedService: SystemsCatalogSeedService,
    private readonly healthService: SystemsHealthService,
  ) {}

  async listEndpoints(query: SystemsListQueryDto) {
    const result = await this.catalogRepository.listEndpoints(query);
    return { items: result.rows.map(mapEndpoint), meta: result.meta };
  }

  async getEndpoint(endpointId: string) {
    const endpoint = await this.catalogRepository.findEndpointById(endpointId);
    if (!endpoint) throw new NotFoundException('SYSTEM_ENDPOINT_NOT_FOUND');
    const [tools, dataImpacts, fieldImpacts] = await Promise.all([
      this.catalogRepository.findToolRequirementsByEndpoint(endpointId),
      this.catalogRepository.findDataImpactsByEndpoint(endpointId),
      this.catalogRepository.findFieldImpactsByEndpoint(endpointId),
    ]);
    const [enrichedTools, enrichedDataImpacts, enrichedFieldImpacts] = await Promise.all([
      this.enrichToolRequirements(tools),
      this.enrichDataImpacts(dataImpacts),
      this.enrichFieldImpacts(fieldImpacts),
    ]);
    return {
      endpoint: mapEndpoint(endpoint),
      toolRequirements: enrichedTools,
      dataEntityImpacts: enrichedDataImpacts,
      fieldImpacts: enrichedFieldImpacts,
    };
  }

  discoverEndpoints(body: DiscoverEndpointsDto) {
    return this.discovery.discoverAndMaybePersist(body.persist);
  }

  refreshCatalogSeed(body: CatalogSeedRefreshDto) {
    return this.seedService.refreshCatalog(body);
  }

  async listDomains(query: SystemsListQueryDto) {
    const result = await this.catalogRepository.listDomains(query);
    return { items: result.rows.map(mapDomain), meta: result.meta };
  }

  async getDomain(domainCode: string) {
    const domain = await this.catalogRepository.findDomainByCode(domainCode);
    if (!domain) throw new NotFoundException('SYSTEM_DOMAIN_NOT_FOUND');
    return mapDomain(domain);
  }

  async listTools(query: SystemsListQueryDto) {
    const result = await this.catalogRepository.listTools(query);
    return { items: result.rows.map(mapTool), meta: result.meta };
  }

  async getTool(toolId: string) {
    const tool = await this.catalogRepository.findToolById(toolId);
    if (!tool) throw new NotFoundException('SYSTEM_TOOL_NOT_FOUND');
    return mapTool(tool);
  }

  async listDataEntities(query: SystemsListQueryDto) {
    const result = await this.catalogRepository.listDataEntities(query);
    return { items: result.rows.map(mapDataEntity), meta: result.meta };
  }

  async getDataEntity(entityId: string) {
    const entity = await this.catalogRepository.findDataEntityById(entityId);
    if (!entity) throw new NotFoundException('SYSTEM_DATA_ENTITY_NOT_FOUND');
    const [columns, relations] = await Promise.all([
      this.catalogRepository.findFieldsByEntity(entityId),
      this.catalogRepository.findRelationshipsByTable(entity.schemaName, entity.tableName),
    ]);
    return {
      ...mapDataEntity(entity),
      columns: columns.map(mapDataField),
      relatedColumns: columns.map(mapDataField),
      relations: relations.map(mapDataRelationship),
      relatedTables: [...new Set(relations.map((relation) => relation.sourceTable === entity.tableName ? relation.targetTable : relation.sourceTable))],
    };
  }



  async updateDataEntityMetadata(entityId: string, body: Record<string, unknown>) {
    const entity = await this.catalogRepository.updateDataEntityMetadata(entityId, body);
    if (!entity) throw new NotFoundException('SYSTEM_DATA_ENTITY_NOT_FOUND');
    return mapDataEntity(entity);
  }

  async getImpactByEndpoint(endpointId: string) {
    const endpoint = await this.catalogRepository.findEndpointById(endpointId);
    if (!endpoint) throw new NotFoundException('SYSTEM_ENDPOINT_NOT_FOUND');
    const [tools, dataImpacts, fieldImpacts] = await Promise.all([
      this.catalogRepository.findToolRequirementsByEndpoint(endpointId),
      this.catalogRepository.findDataImpactsByEndpoint(endpointId),
      this.catalogRepository.findFieldImpactsByEndpoint(endpointId),
    ]);
    const [enrichedTools, enrichedTables, enrichedFields] = await Promise.all([
      this.enrichToolRequirements(tools),
      this.enrichDataImpacts(dataImpacts),
      this.enrichFieldImpacts(fieldImpacts),
    ]);
    return {
      endpoint: mapEndpoint(endpoint),
      tools: enrichedTools,
      tables: enrichedTables,
      fields: enrichedFields,
    };
  }

  async getImpactByTable(schemaName: string, tableName: string) {
    const entity = await this.catalogRepository.findDataEntityByTable(schemaName, tableName);
    if (!entity) throw new NotFoundException('SYSTEM_DATA_ENTITY_NOT_FOUND');
    const [impacts, columns, relations, fieldImpacts] = await Promise.all([
      this.catalogRepository.findDataImpactsByEntity(String(entity.id)),
      this.catalogRepository.findFieldsByTable(schemaName, tableName),
      this.catalogRepository.findRelationshipsByTable(schemaName, tableName),
      this.catalogRepository.findFieldImpactsByDataEntity(String(entity.id)),
    ]);
    return {
      entity: mapDataEntity(entity),
      endpointImpacts: impacts.map((impact) => mapDataImpact(impact, entity)),
      columns: columns.map(mapDataField),
      relations: relations.map(mapDataRelationship),
      fieldImpacts: fieldImpacts.map((impact) => mapFieldImpact(impact, entity)),
    };
  }

  private async enrichToolRequirements(rows: Awaited<ReturnType<SystemsCatalogRepository['findToolRequirementsByEndpoint']>>) {
    const toolIds = [...new Set(rows.map((row) => String(row.toolId)))];
    const tools = await this.catalogRepository.findToolsByIds(toolIds);
    const toolsById = new Map(tools.map((tool) => [String(tool.id), tool]));
    return rows.map((row) => mapToolRequirement(row, toolsById.get(String(row.toolId))));
  }

  private async enrichDataImpacts(rows: Awaited<ReturnType<SystemsCatalogRepository['findDataImpactsByEndpoint']>>) {
    const entityIds = [...new Set(rows.map((row) => String(row.dataEntityId)))];
    const entities = await this.catalogRepository.findDataEntitiesByIds(entityIds);
    const entitiesById = new Map(entities.map((entity) => [String(entity.id), entity]));
    return rows.map((row) => mapDataImpact(row, entitiesById.get(String(row.dataEntityId))));
  }

  private async enrichFieldImpacts(rows: Awaited<ReturnType<SystemsCatalogRepository['findFieldImpactsByEndpoint']>>) {
    const entityIds = [...new Set(rows.map((row) => String(row.dataEntityId)))];
    const entities = await this.catalogRepository.findDataEntitiesByIds(entityIds);
    const entitiesById = new Map(entities.map((entity) => [String(entity.id), entity]));
    return rows.map((row) => mapFieldImpact(row, entitiesById.get(String(row.dataEntityId))));
  }

  getToolsHealth() {
    return this.healthService.getToolsHealth();
  }

  async getDashboard() {
    const counts = await this.dashboardRepository.getDashboardCounts();
    return {
      counts,
      posture: {
        catalogCoverage: counts.endpoints > 0 && counts.dataEntities > 0 ? 'READY_FOR_REVIEW' : 'NEEDS_SEED_REFRESH',
        pendingReviews: counts.pendingReviews,
        stressProfilesEnabled: counts.stressProfiles,
      },
    };
  }
}
