/**
 * @file Servicio de aplicación: el mapa de dominios de negocio con sus cifras, calculado en el servidor.
 * @business Responde «¿qué parte del negocio toca este endpoint o esta tabla?» con números que cuadran.
 * @system cruza el catálogo de dominios con tablas, impactos endpoint→tabla y suites; sin paginar por el camino.
 */
import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import {
  SystemDataEntityCatalogModel,
  SystemDomainCatalogModel,
  SystemEndpointCatalogModel,
  SystemEndpointDataEntityImpactModel,
  SystemTestSuiteModel,
} from '../../database/models/index.js';
import { DOMAIN_BUSINESS_METADATA, TABLE_BUSINESS_METADATA } from './systems-business-metadata.fixtures.js';
import { mapDomain } from './systems-ops.mapper.js';

/** Estados de revisión que cuentan como «pendiente» en el mapa. */
const PENDING_REVIEW = new Set(['NEEDS_REVIEW', 'AUTO_DETECTED']);
const CRITICAL_RISK = new Set(['HIGH', 'CRITICAL']);

export type DomainOverviewItem = {
  domainCode: string;
  domainName: string;
  description: string | null;
  ownerTeam: string | null;
  dataNature: string | null;
  status: string | null;
  tables: number;
  piiTables: number;
  endpoints: number;
  criticalEndpoints: number;
  testSuites: number;
  pendingReview: number;
  /** Módulos (de tablas) que caen en este dominio: es lo que enlaza con las vistas de endpoints y tablas. */
  modules: string[];
};

export type DomainOverview = {
  generatedAt: string;
  /** De dónde salió la lista de dominios: del catálogo en base o de las fichas en código, si el catálogo está vacío. */
  domainSource: 'catalog' | 'fixtures';
  items: DomainOverviewItem[];
  unassigned: {
    tables: number;
    endpoints: number;
    /** Los módulos con tablas sin dominio, de más a menos: es la lista de lo que falta clasificar. */
    modules: { module: string; tables: number }[];
  };
  totals: { tables: number; endpoints: number; testSuites: number };
};

/**
 * El mapa de dominios se calculaba en el navegador cruzando TRES listados paginados a 100 filas.
 *
 * Con 432 endpoints y 186 tablas en el catálogo, la pantalla construía el mapa sobre 100 de cada:
 * dominios que faltaban y cifras falsas sin que nada lo delatara, porque 100 filas también «cargan
 * bien». Y el cruce se hacía por el `module` del endpoint —el primer segmento de su ruta— que no
 * tiene por qué coincidir con el módulo de una tabla ni con el código de un dominio.
 *
 * Aquí se calcula entero, en el servidor, con la relación que sí existe: cada tabla tiene (o puede
 * tener) un `domain_code`, y cada endpoint declara qué tablas toca en `system_endpoint_data_entity_impacts`.
 * Un endpoint pertenece a los dominios de las tablas que toca.
 *
 * ## Las fichas de negocio en código
 *
 * `systems-business-metadata.fixtures.ts` lleva 86 tablas con su dominio y las 19 fichas de dominio,
 * y no lo importaba nadie. Se usan como RESPALDO: para las tablas cuyo `domain_code` está vacío, y
 * para la lista de dominios cuando el catálogo en base está vacío (que es lo normal en un entorno
 * recién levantado, porque la siembra vive fuera del repositorio). La respuesta dice de dónde salió
 * la lista (`domainSource`), para que «19 dominios» no se lea igual cuando los puso alguien en la
 * base que cuando los trajo el código.
 */
@Injectable()
export class SystemsDomainOverviewService {
  private readonly fixtureDomainByTable = new Map(
    TABLE_BUSINESS_METADATA.map((entry) => [entry.tableName, entry.domainCode] as const),
  );

  constructor(
    @InjectModel(SystemDomainCatalogModel) private readonly domainModel: typeof SystemDomainCatalogModel,
    @InjectModel(SystemDataEntityCatalogModel) private readonly dataEntityModel: typeof SystemDataEntityCatalogModel,
    @InjectModel(SystemEndpointCatalogModel) private readonly endpointModel: typeof SystemEndpointCatalogModel,
    @InjectModel(SystemEndpointDataEntityImpactModel)
    private readonly dataImpactModel: typeof SystemEndpointDataEntityImpactModel,
    @InjectModel(SystemTestSuiteModel) private readonly testSuiteModel: typeof SystemTestSuiteModel,
  ) {}

  async overview(): Promise<DomainOverview> {
    const [domains, entities, endpoints, impacts, suites] = await Promise.all([
      this.loadDomains(),
      this.dataEntityModel.findAll({
        attributes: ['id', 'tableName', 'module', 'domainCode', 'containsPii', 'reviewStatus'],
      }),
      this.endpointModel.findAll({ attributes: ['id', 'module', 'riskLevel', 'reviewStatus'] }),
      this.dataImpactModel.findAll({ attributes: ['endpointId', 'dataEntityId'] }),
      this.testSuiteModel.findAll({ attributes: ['id', 'module'] }),
    ]);

    const items = new Map<string, DomainOverviewItem>(
      domains.items.map((domain) => [domain.domainCode, { ...domain }] as const),
    );
    const domainByEntity = new Map<string, string>();
    const modulesByDomain = new Map<string, Set<string>>();
    const unassignedByModule = new Map<string, number>();

    for (const entity of entities) {
      const domainCode = entity.domainCode?.trim() || this.fixtureDomainByTable.get(entity.tableName) || null;
      const item = domainCode ? items.get(domainCode) : undefined;
      if (!item) {
        const moduleKey = normalizeModule(entity.module);
        unassignedByModule.set(moduleKey, (unassignedByModule.get(moduleKey) ?? 0) + 1);
        continue;
      }
      domainByEntity.set(String(entity.id), item.domainCode);
      item.tables += 1;
      if (entity.containsPii) item.piiTables += 1;
      if (PENDING_REVIEW.has(entity.reviewStatus)) item.pendingReview += 1;
      if (!modulesByDomain.has(item.domainCode)) modulesByDomain.set(item.domainCode, new Set());
      modulesByDomain.get(item.domainCode)!.add(normalizeModule(entity.module));
    }

    // Un endpoint cuenta UNA vez por dominio aunque toque varias tablas del mismo.
    const endpointById = new Map(endpoints.map((endpoint) => [String(endpoint.id), endpoint] as const));
    const domainsByEndpoint = new Map<string, Set<string>>();
    for (const impact of impacts) {
      const domainCode = domainByEntity.get(String(impact.dataEntityId));
      if (!domainCode) continue;
      const endpointId = String(impact.endpointId);
      if (!domainsByEndpoint.has(endpointId)) domainsByEndpoint.set(endpointId, new Set());
      domainsByEndpoint.get(endpointId)!.add(domainCode);
    }
    let unassignedEndpoints = 0;
    for (const [endpointId, endpoint] of endpointById) {
      const domainCodes = domainsByEndpoint.get(endpointId);
      if (!domainCodes || domainCodes.size === 0) {
        unassignedEndpoints += 1;
        continue;
      }
      for (const domainCode of domainCodes) {
        const item = items.get(domainCode)!;
        item.endpoints += 1;
        if (CRITICAL_RISK.has(endpoint.riskLevel)) item.criticalEndpoints += 1;
        if (PENDING_REVIEW.has(endpoint.reviewStatus)) item.pendingReview += 1;
      }
    }

    // Las suites sólo saben su módulo; se atribuyen a los dominios cuyas tablas viven en ese módulo.
    for (const suite of suites) {
      const moduleKey = normalizeModule(suite.module);
      for (const [domainCode, modules] of modulesByDomain) {
        if (modules.has(moduleKey)) items.get(domainCode)!.testSuites += 1;
      }
    }

    for (const [domainCode, modules] of modulesByDomain) {
      items.get(domainCode)!.modules = Array.from(modules).sort();
    }

    return {
      generatedAt: new Date().toISOString(),
      domainSource: domains.source,
      items: Array.from(items.values()).sort((a, b) => b.tables + b.endpoints - (a.tables + a.endpoints)),
      unassigned: {
        tables: Array.from(unassignedByModule.values()).reduce((sum, count) => sum + count, 0),
        endpoints: unassignedEndpoints,
        modules: Array.from(unassignedByModule.entries())
          .map(([module, tables]) => ({ module, tables }))
          .sort((a, b) => b.tables - a.tables),
      },
      totals: { tables: entities.length, endpoints: endpoints.length, testSuites: suites.length },
    };
  }

  private async loadDomains(): Promise<{ source: 'catalog' | 'fixtures'; items: DomainOverviewItem[] }> {
    const rows = await this.domainModel.findAll({ order: [['domainCode', 'ASC']] });
    if (rows.length > 0) {
      return {
        source: 'catalog',
        items: rows.map((row) => {
          const domain = mapDomain(row);
          return emptyItem({
            domainCode: domain.domainCode,
            domainName: domain.domainName,
            description: domain.description ?? null,
            ownerTeam: domain.ownerTeam ?? null,
            dataNature: domain.dataNature ?? null,
            status: domain.status ?? null,
          });
        }),
      };
    }
    return {
      source: 'fixtures',
      items: DOMAIN_BUSINESS_METADATA.map((domain) =>
        emptyItem({
          domainCode: domain.domainCode,
          domainName: domain.domainName,
          description: domain.description,
          ownerTeam: domain.ownerTeam,
          dataNature: domain.dataNature,
          status: null,
        }),
      ),
    };
  }
}

function emptyItem(
  head: Pick<DomainOverviewItem, 'domainCode' | 'domainName' | 'description' | 'ownerTeam' | 'dataNature' | 'status'>,
): DomainOverviewItem {
  return {
    ...head,
    tables: 0,
    piiTables: 0,
    endpoints: 0,
    criticalEndpoints: 0,
    testSuites: 0,
    pendingReview: 0,
    modules: [],
  };
}

/** Los módulos llegan con guiones (tablas) o guiones bajos (endpoints): una sola clave. */
function normalizeModule(value: string | null | undefined): string {
  return (value?.trim() || 'sin_modulo').toLowerCase().replace(/-/g, '_');
}
