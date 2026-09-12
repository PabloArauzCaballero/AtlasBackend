/**
 * @file Puerto de persistencia: encapsula consultas, locks y escrituras.
 * @business Lee el catálogo con el que se clasifica, enruta y promete: colas, categorías y SLA.
 * @system consultas de sólo lectura sobre los catálogos versionados del schema `support`.
 */
import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { Op, Transaction } from 'sequelize';
import {
  SupportCannedResponseModel,
  SupportCaseCategoryModel,
  SupportQueueModel,
  SupportSlaPolicyModel,
} from '../../database/models/index.js';
import type { SupportPriority } from './support.constants.js';

export type RepositoryOptions = { transaction?: Transaction };

@Injectable()
export class SupportCatalogRepository {
  constructor(
    @InjectModel(SupportQueueModel) private readonly queues: typeof SupportQueueModel,
    @InjectModel(SupportCaseCategoryModel) private readonly categories: typeof SupportCaseCategoryModel,
    @InjectModel(SupportSlaPolicyModel) private readonly slaPolicies: typeof SupportSlaPolicyModel,
    @InjectModel(SupportCannedResponseModel) private readonly cannedResponses: typeof SupportCannedResponseModel,
  ) {}

  findQueueByCode(tenantId: string, queueCode: string, options: RepositoryOptions = {}): Promise<SupportQueueModel | null> {
    return this.queues.findOne({
      where: { tenantId, queueCode, isActive: true, deleted: false },
      transaction: options.transaction,
    });
  }

  findQueueById(tenantId: string, queueId: string, options: RepositoryOptions = {}): Promise<SupportQueueModel | null> {
    return this.queues.findOne({ where: { tenantId, id: queueId, deleted: false }, transaction: options.transaction });
  }

  listQueues(tenantId: string, contextType?: string): Promise<SupportQueueModel[]> {
    return this.queues.findAll({
      where: { tenantId, isActive: true, deleted: false, ...(contextType ? { contextType } : {}) },
      order: [
        ['display_order', 'ASC'],
        ['queue_code', 'ASC'],
      ],
    });
  }

  /**
   * La categoría vigente por código.
   *
   * Se pide la de MAYOR `catalogVersion` porque reorganizar la taxonomía publica una versión nueva
   * sin borrar la anterior: los casos ya clasificados siguen apuntando a la suya, y los nuevos
   * entran por la vigente. Buscar sin ordenar habría devuelto cualquiera de las dos.
   */
  findCategoryByCode(tenantId: string, categoryCode: string, options: RepositoryOptions = {}): Promise<SupportCaseCategoryModel | null> {
    return this.categories.findOne({
      where: { tenantId, categoryCode, isActive: true, deleted: false },
      order: [['catalog_version', 'DESC']],
      transaction: options.transaction,
    });
  }

  findCategoryById(tenantId: string, categoryId: string, options: RepositoryOptions = {}): Promise<SupportCaseCategoryModel | null> {
    return this.categories.findOne({ where: { tenantId, id: categoryId, deleted: false }, transaction: options.transaction });
  }

  /** El árbol que se le ofrece a quien va a abrir un caso, ya filtrado por audiencia. */
  listCategories(tenantId: string, audiences: readonly string[]): Promise<SupportCaseCategoryModel[]> {
    return this.categories.findAll({
      where: { tenantId, isActive: true, deleted: false, audience: { [Op.in]: [...audiences, 'ANY'] } },
      order: [
        ['display_order', 'ASC'],
        ['category_code', 'ASC'],
      ],
    });
  }

  /**
   * La política de SLA que se aplicará: la activa de mayor versión para esa prioridad.
   *
   * Devuelve la versión concreta —no los plazos— porque el caso guarda su identificador. Si mañana
   * se publica la versión 3 con plazos más laxos, el caso de hoy se seguirá midiendo con la 2, que
   * es lo que se prometió cuando se abrió.
   */
  findActiveSlaPolicy(
    tenantId: string,
    policyCode: string,
    priority: SupportPriority,
    options: RepositoryOptions = {},
  ): Promise<SupportSlaPolicyModel | null> {
    return this.slaPolicies.findOne({
      where: { tenantId, policyCode, priority, status: 'active', deleted: false },
      order: [['version_number', 'DESC']],
      transaction: options.transaction,
    });
  }

  findSlaPolicyById(tenantId: string, policyId: string, options: RepositoryOptions = {}): Promise<SupportSlaPolicyModel | null> {
    return this.slaPolicies.findOne({ where: { tenantId, id: policyId, deleted: false }, transaction: options.transaction });
  }

  /** Las respuestas rápidas publicadas para una audiencia. El agente nunca ve borradores. */
  listCannedResponses(tenantId: string, audiences: readonly string[]): Promise<SupportCannedResponseModel[]> {
    return this.cannedResponses.findAll({
      where: { tenantId, status: 'published', deleted: false, audience: { [Op.in]: [...audiences] } },
      order: [
        ['response_code', 'ASC'],
        ['version_number', 'DESC'],
      ],
    });
  }

  async requireQueueByCode(tenantId: string, queueCode: string, options: RepositoryOptions = {}): Promise<SupportQueueModel> {
    const queue = await this.findQueueByCode(tenantId, queueCode, options);
    if (!queue) throw new NotFoundException({ code: 'SUPPORT_QUEUE_NOT_FOUND', queueCode });
    return queue;
  }
}
