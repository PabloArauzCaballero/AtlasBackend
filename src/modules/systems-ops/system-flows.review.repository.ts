/**
 * @file Repositorio de la capa de datos: encapsula el acceso a PostgreSQL.
 * @business Esta pieza guarda qué confirmó o rechazó una persona de cada flujo, y sobre qué código.
 * @system escribe el estado de revisión del catálogo de flujos y su rastro en los eventos de revisión.
 */
import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { Op, Transaction } from 'sequelize';
import { SystemCatalogReviewEventModel } from '../../database/models/system-catalog-review-events.model.js';
import { SystemFlowCatalogModel } from '../../database/models/system-flow-catalog.model.js';
import type { ReviewDecisionDto } from './systems-ops.schemas.js';
import type { FlowReviewQueueDto } from './system-flows.review.schemas.js';

export type ActorDeRevision = { id: string | null; role: string; tenantId: string | null };

@Injectable()
export class SystemFlowsReviewRepository {
  constructor(
    @InjectModel(SystemFlowCatalogModel) private readonly flows: typeof SystemFlowCatalogModel,
    @InjectModel(SystemCatalogReviewEventModel) private readonly events: typeof SystemCatalogReviewEventModel,
  ) {}

  /** Pide revisión SÓLO a los que nadie ha tocado: una decisión humana no la pisa una recarga. */
  async markForReview(flowIds: readonly string[], tx: Transaction): Promise<number> {
    if (!flowIds.length) return 0;
    const [afectados] = await this.flows.update(
      { reviewStatus: 'NEEDS_REVIEW' },
      { where: { flowId: { [Op.in]: [...flowIds] }, reviewStatus: 'AUTO_DETECTED' }, transaction: tx },
    );
    return afectados;
  }

  /** Devuelve a la cola lo ya decidido cuyo código cambió: la decisión era sobre el código anterior. */
  async reopen(flowIds: readonly string[], tx: Transaction): Promise<number> {
    if (!flowIds.length) return 0;
    const [afectados] = await this.flows.update(
      { reviewStatus: 'NEEDS_REVIEW' },
      { where: { flowId: { [Op.in]: [...flowIds] }, reviewStatus: { [Op.in]: ['APPROVED', 'REJECTED'] } }, transaction: tx },
    );
    return afectados;
  }

  findByFlowId(flowId: string): Promise<SystemFlowCatalogModel | null> {
    return this.flows.findOne({ where: { flowId } });
  }

  /** La decisión y su rastro, en la misma transacción: una sin la otra sería una revisión sin autor. */
  decide(row: SystemFlowCatalogModel, decision: ReviewDecisionDto, actor: ActorDeRevision): Promise<SystemFlowCatalogModel> {
    return this.flows.sequelize!.transaction(async (tx) => {
      const previousStatus = row.reviewStatus;
      const previousConfidence = row.reviewConfidence;
      await row.update(
        {
          reviewStatus: decision.reviewStatus,
          reviewConfidence: decision.confidenceLevel ?? previousConfidence,
          reviewedAt: new Date(),
          reviewedBy: actor.id,
          reviewedDepsHash: row.depsHash,
        },
        { transaction: tx },
      );
      await this.events.create(
        {
          tenantId: actor.tenantId,
          targetType: 'flow',
          targetId: row.id,
          previousStatus,
          newStatus: decision.reviewStatus,
          previousConfidence,
          newConfidence: decision.confidenceLevel ?? previousConfidence,
          notes: decision.notes ?? null,
          actorId: actor.id,
          actorRole: actor.role,
          createdAtValue: new Date(),
        },
        { transaction: tx },
      );
      return row;
    });
  }

  listQueue(query: FlowReviewQueueDto) {
    return this.flows.findAndCountAll({
      where: { reviewStatus: query.reviewStatus, ...(query.systemCode ? { systemCode: query.systemCode } : {}) },
      // CRITICAL antes que HIGH por orden alfabético, y dentro, por bloque y ruta: estable entre páginas.
      order: [
        ['risk', 'ASC'],
        ['systemCode', 'ASC'],
        ['path', 'ASC'],
        ['httpMethod', 'ASC'],
      ],
      limit: query.limit,
      offset: (query.page - 1) * query.limit,
    });
  }
}
