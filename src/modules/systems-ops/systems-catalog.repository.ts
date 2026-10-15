/**
 * @file Puerto de persistencia: encapsula consultas, locks y escrituras.
 * @business Esta pieza hace observable y gobernable el propio backend para operaciones, QA y arquitectura.
 * @system descubre endpoints, cataloga impacto de datos, ejecuta pruebas controladas y expone salud y cobertura.
 */
import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { FindAndCountOptions, FindOptions, Op } from 'sequelize';
import { buildPaginationMeta, toOffset } from '../../common/utils/pagination/pagination.util.js';
import { SystemDataEntityCatalogModel, SystemEndpointCatalogModel, SystemToolCatalogModel } from '../../database/models/index.js';
import { SystemsListQueryDto } from './systems-ops.schemas.js';
import { DataEntitySeed, EndpointSeed, ToolSeed } from './systems-ops.types.js';
import { buildDataEntityRow, buildEndpointRow, buildToolRow } from './systems-catalog-rows.js';
import { buildDataEntityWhere, buildEndpointTextWhere, buildToolWhere } from './systems-repository-where.util.js';

@Injectable()
export class SystemsCatalogRepository {
  constructor(
    @InjectModel(SystemEndpointCatalogModel) private readonly endpointModel: typeof SystemEndpointCatalogModel,
    @InjectModel(SystemToolCatalogModel) private readonly toolModel: typeof SystemToolCatalogModel,
    @InjectModel(SystemDataEntityCatalogModel) private readonly dataEntityModel: typeof SystemDataEntityCatalogModel,
  ) {}

  async listEndpoints(query: SystemsListQueryDto) {
    const result = await this.endpointModel.findAndCountAll({
      where: buildEndpointTextWhere(query),
      order: [
        ['module', 'ASC'],
        ['method', 'ASC'],
        ['fullPath', 'ASC'],
      ],
      limit: query.limit,
      offset: toOffset(query),
    } as FindAndCountOptions);
    return { rows: result.rows, meta: buildPaginationMeta(query, result.count) };
  }

  findEndpointById(endpointId: string): Promise<SystemEndpointCatalogModel | null> {
    return this.endpointModel.findByPk(endpointId);
  }

  findEndpointByMethodAndPath(method: string, fullPath: string): Promise<SystemEndpointCatalogModel | null> {
    return this.endpointModel.findOne({ where: { method: method.toUpperCase(), fullPath } } as FindOptions);
  }

  async upsertEndpoint(seed: EndpointSeed): Promise<void> {
    const now = new Date();
    // El seed curado y el descubrimiento pueden dar códigos distintos a la misma ruta. La
    // identidad física es (bloque, método, ruta); usar `code` choca con el índice de esa clave.
    await this.endpointModel.upsert(buildEndpointRow(seed, now) as never, { conflictFields: ['system_code', 'method', 'full_path'] });
  }

  async markDeprecatedCandidates(activeKeys: Set<string>): Promise<number> {
    // El filtro status/reviewStatus se empuja a SQL (reduce el set a candidatos reales, no todo
    // el catálogo) y el marcado se hace con un solo UPDATE ... WHERE id IN (...) en vez de un
    // row.save() por fila que sigue siendo candidata tras cruzar contra activeKeys.
    const candidates = await this.endpointModel.findAll({
      attributes: ['id', 'method', 'fullPath'],
      where: { status: 'ACTIVE', reviewStatus: { [Op.ne]: 'APPROVED' } } as never,
    } as FindOptions);

    const staleIds = candidates.filter((row) => !activeKeys.has(`${row.method} ${row.fullPath}`)).map((row) => row.id);
    if (staleIds.length === 0) return 0;

    const [updated] = await this.endpointModel.update({ status: 'DEPRECATED_CANDIDATE', updatedAtValue: new Date() } as never, {
      where: { id: { [Op.in]: staleIds } } as never,
    });
    return updated;
  }

  async listTools(query: SystemsListQueryDto) {
    const result = await this.toolModel.findAndCountAll({
      where: buildToolWhere(query),
      order: [['code', 'ASC']],
      limit: query.limit,
      offset: toOffset(query),
    } as FindAndCountOptions);
    return { rows: result.rows, meta: buildPaginationMeta(query, result.count) };
  }

  findToolById(toolId: string): Promise<SystemToolCatalogModel | null> {
    return this.toolModel.findByPk(toolId);
  }

  findToolByCode(code: string): Promise<SystemToolCatalogModel | null> {
    return this.toolModel.findOne({ where: { code } } as FindOptions);
  }

  findToolsByIds(toolIds: string[]): Promise<SystemToolCatalogModel[]> {
    if (toolIds.length === 0) return Promise.resolve([]);
    return this.toolModel.findAll({ where: { id: { [Op.in]: toolIds } } } as FindOptions);
  }

  async upsertTool(seed: ToolSeed): Promise<void> {
    const now = new Date();
    await this.toolModel.upsert(buildToolRow(seed, now) as never);
  }

  async listDataEntities(query: SystemsListQueryDto) {
    const result = await this.dataEntityModel.findAndCountAll({
      where: buildDataEntityWhere(query),
      order: [
        ['module', 'ASC'],
        ['tableName', 'ASC'],
      ],
      limit: query.limit,
      offset: toOffset(query),
    } as FindAndCountOptions);
    return { rows: result.rows, meta: buildPaginationMeta(query, result.count) };
  }

  findDataEntityById(entityId: string): Promise<SystemDataEntityCatalogModel | null> {
    return this.dataEntityModel.unscoped().findByPk(entityId); // unscoped: el detalle sí muestra la narrativa larga.
  }

  findDataEntityByTable(schemaName: string, tableName: string): Promise<SystemDataEntityCatalogModel | null> {
    return this.dataEntityModel.unscoped().findOne({ where: { schemaName, tableName } } as FindOptions);
  }

  findDataEntitiesByIds(entityIds: string[]): Promise<SystemDataEntityCatalogModel[]> {
    if (entityIds.length === 0) return Promise.resolve([]);
    return this.dataEntityModel.findAll({ where: { id: { [Op.in]: entityIds } } } as FindOptions);
  }

  async upsertDataEntity(seed: DataEntitySeed): Promise<void> {
    const now = new Date();
    await this.dataEntityModel.upsert(buildDataEntityRow(seed, now) as never);
  }
}
