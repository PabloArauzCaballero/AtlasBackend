/**
 * @file Puerto de persistencia: encapsula consultas, locks y escrituras.
 * @business Mantiene el catálogo de endpoints que operaciones, QA y arquitectura consultan.
 * @system lista, busca y upserta endpoints del catálogo y marca como candidatos a retiro los que ya no se descubren.
 */
import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { FindAndCountOptions, FindOptions, Op } from 'sequelize';
import { buildPaginationMeta, toOffset } from '../../common/utils/pagination/pagination.util.js';
import { SystemEndpointCatalogModel } from '../../database/models/index.js';
import { SystemsListQueryDto } from './systems-ops.schemas.js';
import { EndpointSeed } from './systems-ops.types.js';
import { buildEndpointRow } from './systems-catalog-rows.js';
import { buildEndpointTextWhere } from './systems-repository-where.util.js';

@Injectable()
export class SystemEndpointCatalogRepository {
  constructor(@InjectModel(SystemEndpointCatalogModel) private readonly endpointModel: typeof SystemEndpointCatalogModel) {}

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
}
