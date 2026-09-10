/**
 * @file Caso de uso de dominio: orquesta reglas y persistencia.
 * @business Esta pieza deja que una persona confirme o rechace lo que el análisis dedujo de un flujo.
 * @system sirve la cola de revisión de flujos con sus motivos y aplica decisiones con rastro.
 */
import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { mapFlow } from './system-flows.mapper.js';
import { SystemFlowsReviewRepository, type ActorDeRevision } from './system-flows.review.repository.js';
import type { FlowReviewDecisionDto, FlowReviewQueueDto } from './system-flows.review.schemas.js';
import { motivosDeRevision } from './system-flows.review.util.js';

@Injectable()
export class SystemFlowsReviewService {
  constructor(private readonly repository: SystemFlowsReviewRepository) {}

  async queue(query: FlowReviewQueueDto) {
    const { rows, count } = await this.repository.listQueue(query);
    return {
      items: rows.map((row) => ({
        ...mapFlow(row),
        // La huella del código actual: hay que devolverla al decidir, para no aprobar un código que no se vio.
        depsHash: row.depsHash,
        reviewStatus: row.reviewStatus,
        reviewConfidence: row.reviewConfidence,
        reviewedAt: row.reviewedAt,
        reviewedBy: row.reviewedBy,
        // Por qué está aquí. Vacío en un NEEDS_REVIEW significa que volvió porque su código cambió después
        // de decidirse: la recarga suelta de la cola lo que se queda sin motivo y nadie revisó.
        reasons: motivosDeRevision(row),
        codeChangedSinceReview: Boolean(row.reviewedDepsHash && row.depsHash !== row.reviewedDepsHash),
      })),
      meta: { page: query.page, limit: query.limit, total: count, totalPages: Math.max(1, Math.ceil(count / query.limit)) },
    };
  }

  async review(flowId: string, decision: FlowReviewDecisionDto, actor: ActorDeRevision) {
    const resultado = await this.repository.decide(flowId, decision, actor);
    if (resultado.outcome === 'NOT_FOUND') throw new NotFoundException(`No existe el flujo ${flowId}.`);
    if (resultado.outcome === 'CONFLICT') {
      throw new ConflictException(
        `El código de este flujo cambió desde que se cargó la cola (huella actual: ${resultado.currentDepsHash ?? 'sin huella'}). Vuelve a cargarla antes de decidir.`,
      );
    }
    const { row } = resultado;
    return {
      flowId: row.flowId,
      reviewStatus: row.reviewStatus,
      reviewConfidence: row.reviewConfidence,
      reviewedAt: row.reviewedAt,
      reviewedBy: row.reviewedBy,
      // Sobre qué código se decidió: si cambia, el flujo vuelve a la cola en la siguiente recarga.
      reviewedDepsHash: row.reviewedDepsHash,
    };
  }
}
