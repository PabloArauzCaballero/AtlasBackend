/**
 * @file Servicio de aplicación o dominio: ejecuta reglas y coordina dependencias.
 * @business Esta pieza cierra el bucle: el motor llega a saber si acertó al decidir.
 * @system entrega al motor los desenlaces encolados por el libro de préstamos, con reintento.
 */
import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { FindOptions, Op } from 'sequelize';
import { LoanOutcomeReportModel } from '../../database/models/index.js';
import { DecisionEngineClient } from './decision-engine.client.js';
import { OutcomeObservationInput } from './decision-engine.types.js';

/** Tras varios intentos fallidos se deja de reintentar solo y se pide mirada humana. */
const MAX_ATTEMPTS = 6;

@Injectable()
export class OutcomeDispatchService {
  private readonly logger = new Logger(OutcomeDispatchService.name);

  constructor(
    private readonly client: DecisionEngineClient,
    @InjectModel(LoanOutcomeReportModel) private readonly reportModel: typeof LoanOutcomeReportModel,
  ) {}

  /**
   * Entrega al motor los desenlaces pendientes.
   *
   * Se manda en LOTE porque el endpoint del motor está pensado así —«el sistema de cobranza cierra
   * miles de casos a la vez, no de uno en uno»— y porque una cartera al día produce cientos de
   * observaciones por barrido.
   *
   * El lote es todo o nada al marcarlo: si la llamada falla, ninguna fila se da por enviada. El
   * motor deduplica por `(executionId, windowDays)`, así que reintentar el lote entero es seguro y
   * es preferible a marcar como enviado algo que quizá no llegó — un desenlace perdido no se vuelve
   * a generar, porque su ventana ya pasó.
   */
  async dispatchPending(input: { tenantId: string | null; limit: number }) {
    if (!this.client.canReportOutcomes) {
      return { sent: 0, failed: 0, skipped: 0, reason: 'DECISION_ENGINE_OUTCOME_KEY_NOT_CONFIGURED' as const };
    }

    const pending = await this.reportModel.findAll({
      where: {
        status: { [Op.in]: ['pending', 'failed'] },
        attempts: { [Op.lt]: MAX_ATTEMPTS },
        ...(input.tenantId ? { tenantId: input.tenantId } : {}),
      },
      order: [['observedAt', 'ASC']],
      limit: input.limit,
    } as FindOptions);

    if (pending.length === 0) return { sent: 0, failed: 0, skipped: 0 };

    const observations: OutcomeObservationInput[] = pending.map((report) => ({
      executionId: report.decisionExecutionId,
      windowDays: report.windowDays,
      label: report.label,
      amount: report.amount === null ? undefined : Number(report.amount),
      source: report.source,
      notes: report.notes ?? undefined,
    }));

    const now = new Date();
    try {
      await this.client.recordOutcomes(observations);
      for (const report of pending) {
        report.status = 'sent';
        report.attempts += 1;
        report.sentAt = now;
        report.lastError = null;
        report.updatedAtValue = now;
        await report.save();
      }
      return { sent: pending.length, failed: 0, skipped: 0 };
    } catch (error) {
      const message = (error as Error).message ?? 'OUTCOME_DISPATCH_FAILED';
      this.logger.error(`No se pudo entregar el lote de ${pending.length} desenlaces: ${message}`);
      for (const report of pending) {
        report.status = 'failed';
        report.attempts += 1;
        report.lastError = message.slice(0, 2_000);
        report.updatedAtValue = now;
        await report.save();
      }
      return { sent: 0, failed: pending.length, skipped: 0 };
    }
  }

  /**
   * Los que agotaron los reintentos. No se esconden: un desenlace que nunca llegó es un agujero en
   * la medida del modelo, y el equipo de riesgo tiene que poder verlo antes de recalibrar sobre una
   * muestra incompleta.
   */
  async listExhausted(tenantId: string | null, limit: number) {
    const rows = await this.reportModel.findAll({
      where: {
        status: 'failed',
        attempts: { [Op.gte]: MAX_ATTEMPTS },
        ...(tenantId ? { tenantId } : {}),
      },
      order: [['observedAt', 'ASC']],
      limit,
    } as FindOptions);

    return {
      items: rows.map((report) => ({
        loanId: report.loanId,
        decisionExecutionId: report.decisionExecutionId,
        windowDays: report.windowDays,
        label: report.label,
        attempts: report.attempts,
        lastError: report.lastError,
        observedAt: report.observedAt,
      })),
    };
  }
}
