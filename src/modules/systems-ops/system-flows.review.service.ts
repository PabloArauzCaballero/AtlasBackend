/**
 * @file Caso de uso de dominio: orquesta reglas y persistencia.
 * @business Esta pieza deja que una persona confirme o rechace lo que el análisis dedujo de un flujo.
 * @system sirve la cola de revisión de flujos con sus motivos y aplica decisiones con rastro.
 */
import { Injectable, NotFoundException } from '@nestjs/common';
import { mapFlow } from './system-flows.mapper.js';
import { SystemFlowsReviewRepository, type ActorDeRevision } from './system-flows.review.repository.js';
import type { FlowReviewQueueDto } from './system-flows.review.schemas.js';
import { motivosDeRevision } from './system-flows.review.util.js';
import type { ReviewDecisionDto } from './systems-ops.schemas.js';

@Injectable()
export class SystemFlowsReviewService {
  constructor(private readonly repository: SystemFlowsReviewRepository) {}

  async queue(query: FlowReviewQueueDto) {
    const { rows, count } = await this.repository.listQueue(query);
    return {
      items: rows.map((row) => ({
        ...mapFlow(row),
        reviewStatus: row.reviewStatus,
        reviewConfidence: row.reviewConfidence,
        reviewedAt: row.reviewedAt,
        reviewedBy: row.reviewedBy,
        // Por qué está aquí. Vacío en un flujo NEEDS_REVIEW significa que volvió a la cola porque su
        // código cambió después de revisarse, no porque el análisis sea incierto.
        reasons: motivosDeRevision(row),
        codeChangedSinceReview: Boolean(row.reviewedDepsHash && row.depsHash !== row.reviewedDepsHash),
      })),
      meta: { page: query.page, limit: query.limit, total: count, totalPages: Math.max(1, Math.ceil(count / query.limit)) },
    };
  }

  async review(flowId: string, decision: ReviewDecisionDto, actor: ActorDeRevision) {
    const row = await this.repository.findByFlowId(flowId);
    if (!row) throw new NotFoundException(`No existe el flujo ${flowId}.`);
    const saved = await this.repository.decide(row, decision, actor);
    return {
      flowId: saved.flowId,
      reviewStatus: saved.reviewStatus,
      reviewConfidence: saved.reviewConfidence,
      reviewedAt: saved.reviewedAt,
      reviewedBy: saved.reviewedBy,
      // Sobre qué código se decidió: si cambia, el flujo vuelve a la cola en la siguiente recarga.
      reviewedDepsHash: saved.reviewedDepsHash,
    };
  }
}
