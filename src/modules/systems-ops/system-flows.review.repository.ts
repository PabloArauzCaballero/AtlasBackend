/**
 * @file Repositorio de la capa de datos: encapsula el acceso a PostgreSQL.
 * @business Esta pieza guarda qué confirmó o rechazó una persona de cada flujo, y sobre qué código.
 * @system escribe el estado de revisión del catálogo de flujos y su rastro en los eventos de revisión.
 */
import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { literal, Op, Transaction } from 'sequelize';
import { SystemCatalogReviewEventModel } from '../../database/models/system-catalog-review-events.model.js';
import { SystemFlowCatalogModel } from '../../database/models/system-flow-catalog.model.js';
import type { FlowReviewDecisionDto, FlowReviewQueueDto } from './system-flows.review.schemas.js';

export type ActorDeRevision = { id: string | null; role: string; tenantId: string | null };

export type ResultadoDeDecision =
  { outcome: 'NOT_FOUND' } | { outcome: 'CONFLICT'; currentDepsHash: string | null } | { outcome: 'OK'; row: SystemFlowCatalogModel };

const DECIDIDOS = ['APPROVED', 'REJECTED'];

@Injectable()
export class SystemFlowsReviewRepository {
  constructor(
    @InjectModel(SystemFlowCatalogModel) private readonly flows: typeof SystemFlowCatalogModel,
    @InjectModel(SystemCatalogReviewEventModel) private readonly events: typeof SystemCatalogReviewEventModel,
  ) {}

  catalogSize(systemCode: string, tx: Transaction): Promise<number> {
    return this.flows.count({ where: { systemCode }, transaction: tx });
  }

  /** Decisiones que se perderían al retirar los flujos que ya no vienen en la carga. */
  decisionsToBeRemoved(systemCode: string, keepFlowIds: readonly string[], tx: Transaction): Promise<number> {
    return this.flows.count({
      where: {
        systemCode,
        reviewStatus: { [Op.in]: DECIDIDOS },
        ...(keepFlowIds.length ? { flowId: { [Op.notIn]: [...keepFlowIds] } } : {}),
      },
      transaction: tx,
    });
  }

  /** Pide revisión SÓLO a los que nadie ha tocado: una decisión humana no la pisa una recarga. */
  markForReview(flowIds: readonly string[], tx: Transaction): Promise<number> {
    return this.moveStatus(flowIds, { reviewStatus: 'AUTO_DETECTED' }, 'NEEDS_REVIEW', tx);
  }

  /** Suelta de la cola lo que ya no tiene motivo y nadie revisó: si no, se quedaba ahí sin explicar por qué. */
  release(flowIds: readonly string[], tx: Transaction): Promise<number> {
    return this.moveStatus(flowIds, { reviewStatus: 'NEEDS_REVIEW', reviewedAt: null }, 'AUTO_DETECTED', tx);
  }

  /** Devuelve a la cola lo ya decidido cuyo código cambió: la decisión era sobre el código anterior. */
  reopen(flowIds: readonly string[], tx: Transaction): Promise<number> {
    return this.moveStatus(flowIds, { reviewStatus: { [Op.in]: DECIDIDOS } }, 'NEEDS_REVIEW', tx);
  }

  /**
   * Y lo decidido cuando el flujo aún no tenía huella: no se sabe sobre qué código se decidió, así que
   * en cuanto llega una huella vuelve a la cola una vez, y la nueva decisión ya queda atada a ella.
   */
  reopenWithoutReviewedHash(flowIds: readonly string[], tx: Transaction): Promise<number> {
    return this.moveStatus(flowIds, { reviewStatus: { [Op.in]: DECIDIDOS }, reviewedDepsHash: null }, 'NEEDS_REVIEW', tx);
  }

  /**
   * La decisión, su rastro y la comprobación de la huella, en una transacción y con la fila bloqueada:
   * si una recarga cambió el código entre que se cargó la cola y se decidió, no se decide nada.
   */
  decide(flowId: string, decision: FlowReviewDecisionDto, actor: ActorDeRevision): Promise<ResultadoDeDecision> {
    return this.flows.sequelize!.transaction(async (tx) => {
      const row = await this.flows.findOne({ where: { flowId }, transaction: tx, lock: tx.LOCK.UPDATE });
      if (!row) return { outcome: 'NOT_FOUND' } as const;
      if (row.depsHash !== decision.depsHash) return { outcome: 'CONFLICT', currentDepsHash: row.depsHash } as const;
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
      return { outcome: 'OK', row } as const;
    });
  }

  listQueue(query: FlowReviewQueueDto) {
    return this.flows.findAndCountAll({
      where: { reviewStatus: query.reviewStatus, ...(query.systemCode ? { systemCode: query.systemCode } : {}) },
      // Por significado, como el listado de flujos: por alfabeto, LOW saldría antes que MEDIUM.
      order: [
        [literal(`CASE risk WHEN 'CRITICAL' THEN 0 WHEN 'HIGH' THEN 1 WHEN 'MEDIUM' THEN 2 ELSE 3 END`), 'ASC'],
        ['systemCode', 'ASC'],
        ['path', 'ASC'],
        ['httpMethod', 'ASC'],
      ],
      limit: query.limit,
      offset: (query.page - 1) * query.limit,
    });
  }

  private async moveStatus(flowIds: readonly string[], where: Record<string, unknown>, to: string, tx: Transaction): Promise<number> {
    if (!flowIds.length) return 0;
    const [afectados] = await this.flows.update(
      { reviewStatus: to },
      { where: { flowId: { [Op.in]: [...flowIds] }, ...where }, transaction: tx },
    );
    return afectados;
  }
}
