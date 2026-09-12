/**
 * @file Servicio de aplicación o dominio: ejecuta reglas y coordina dependencias.
 * @business Esta pieza cierra el bucle: el motor llega a saber si acertó al decidir.
 * @system entrega al motor los desenlaces encolados por el libro de préstamos, con reintento.
 */
import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { FindOptions, Op } from 'sequelize';
import { LoanModel, LoanOutcomeReportModel } from '../../database/models/index.js';
import { DecisionEngineClient } from './decision-engine.client.js';
import { FacilityRegistrationService } from './facility-registration.service.js';
import { FacilityOutcomeInput } from './decision-engine.types.js';

/** Tras varios intentos fallidos se deja de reintentar solo y se pide mirada humana. */
const MAX_ATTEMPTS = 6;

@Injectable()
export class OutcomeDispatchService {
  private readonly logger = new Logger(OutcomeDispatchService.name);

  constructor(
    private readonly client: DecisionEngineClient,
    @InjectModel(LoanOutcomeReportModel) private readonly reportModel: typeof LoanOutcomeReportModel,
    @InjectModel(LoanModel) private readonly loanModel: typeof LoanModel,
    private readonly facilities: FacilityRegistrationService,
  ) {}

  /**
   * Fachada para la capa de trabajos: el catálogo de jobs no tiene que conocer cómo está repartido
   * este módulo por dentro, y así no se añade otra arista `runtime-jobs → decision-engine`.
   */
  registrarCreditosNuevos(input: { tenantId: string | null; limit: number }) {
    return this.facilities.registrarCreditosNuevos(input);
  }

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

    /*
     * El desenlace se manda identificado por el CRÉDITO, así que primero hay que traducir de
     * `loanId` a `loanCode` — que es lo que el motor conoce como `externalReference`—.
     *
     * Un informe cuyo préstamo ya no exista, o que no traiga código, se SALTA en vez de tumbar el
     * lote: es una fila huérfana y reintentarla eternamente sólo consigue que el lote nunca avance y
     * que los desenlaces buenos se queden detrás de ella.
     */
    const loans = await this.loanModel.findAll({
      where: { id: { [Op.in]: [...new Set(pending.map((report) => report.loanId))] } },
    } as FindOptions);
    const codigoPorPrestamo = new Map(loans.map((loan) => [String(loan.id), loan.loanCode]));

    const enviables = pending.filter((report) => codigoPorPrestamo.has(String(report.loanId)));
    const huerfanos = pending.filter((report) => !codigoPorPrestamo.has(String(report.loanId)));

    const now = new Date();
    await this.cerrarHuerfanos(huerfanos, now);

    if (enviables.length === 0) {
      return { sent: 0, failed: huerfanos.length, skipped: 0 };
    }

    const outcomes: FacilityOutcomeInput[] = enviables.map((report) => ({
      externalReference: codigoPorPrestamo.get(String(report.loanId)) as string,
      windowDays: report.windowDays,
      label: report.label,
      amount: report.amount === null ? undefined : Number(report.amount),
      source: report.source,
      notes: report.notes ?? undefined,
    }));

    try {
      /*
       * Aquí NO se registra el crédito, y esa división es deliberada.
       *
       * `/v1/outcomes/batch` exige que el crédito exista en el motor, así que la tentación es darlo
       * de alta antes de cada envío. Pero eso son dos caminos para lo mismo: el trabajo
       * `register_engine_facilities` ya recorre los créditos sin marca de alta cada intervalo. Un
       * desenlace cuyo crédito todavía no está registrado se rechaza con `FACILITY_NOT_FOUND`,
       * se queda en la cola y entra en el envío siguiente — y si su alta no es posible nunca
       * (una decisión sin sujeto), acaba en `listExhausted`, que es la cola que una persona sí mira.
       */
      const resultados = await this.client.recordFacilityOutcomes(outcomes);
      const rechazos = new Map(
        resultados.filter((row) => !row.accepted).map((row) => [`${row.externalReference}#${row.windowDays}`, row.reason]),
      );

      const { enviados, rechazadas } = await this.marcarPorFila(enviables, codigoPorPrestamo, rechazos, now);
      const fallidos = rechazadas + huerfanos.length;
      if (rechazadas > 0) {
        this.logger.warn(`El motor rechazó ${rechazadas} de ${enviables.length} desenlaces; el motivo de cada uno queda en su last_error.`);
      }
      return { sent: enviados, failed: fallidos, skipped: 0 };
    } catch (error) {
      const message = (error as Error).message ?? 'OUTCOME_DISPATCH_FAILED';
      this.logger.error(`No se pudo entregar el lote de ${enviables.length} desenlaces: ${message}`);
      for (const report of enviables) {
        report.status = 'failed';
        report.attempts += 1;
        report.lastError = message.slice(0, 2_000);
        report.updatedAtValue = now;
        await report.save();
      }
      return { sent: 0, failed: enviables.length + huerfanos.length, skipped: 0 };
    }
  }

  /**
   * Cierra los informes cuyo préstamo ya no existe, agotando sus reintentos.
   *
   * Se agota a propósito en vez de dejarlos reintentando: una fila huérfana no se arregla sola y
   * reintentarla eternamente hace que el lote nunca avance, así que los desenlaces buenos se quedan
   * detrás de ella. Aparecen en `listExhausted`, que es la cola que una persona sí mira.
   */
  private async cerrarHuerfanos(huerfanos: readonly LoanOutcomeReportModel[], now: Date): Promise<void> {
    for (const report of huerfanos) {
      report.status = 'failed';
      report.attempts = MAX_ATTEMPTS;
      report.lastError = 'LOAN_NOT_FOUND: el préstamo del informe ya no existe, no hay crédito al que atribuirlo.';
      report.updatedAtValue = now;
      await report.save();
    }
  }

  /**
   * Marca cada informe según lo que dijo el motor de SU fila.
   *
   * Fila a fila y no el lote entero: el motor devuelve el veredicto de cada desenlace justamente para
   * que quien carga no tenga que reenviar el archivo completo por dos filas malas. Dar por enviado un
   * lote con rechazos dentro perdería esos dos para siempre, porque su ventana ya pasó y no se
   * vuelven a generar.
   */
  private async marcarPorFila(
    enviables: readonly LoanOutcomeReportModel[],
    codigoPorPrestamo: Map<string, string>,
    rechazos: Map<string, string | null>,
    now: Date,
  ): Promise<{ enviados: number; rechazadas: number }> {
    let enviados = 0;
    let rechazadas = 0;
    for (const report of enviables) {
      const clave = `${codigoPorPrestamo.get(String(report.loanId))}#${report.windowDays}`;
      const rechazo = rechazos.get(clave);
      report.attempts += 1;
      report.updatedAtValue = now;
      if (rechazo === undefined) {
        report.status = 'sent';
        report.sentAt = now;
        report.lastError = null;
        enviados += 1;
      } else {
        report.status = 'failed';
        report.lastError = String(rechazo).slice(0, 2_000);
        rechazadas += 1;
      }
      await report.save();
    }
    return { enviados, rechazadas };
  }

  /**
   * Si la entrega va al día, en cuatro cifras.
   *
   * Es lo que el portal enseña en lugar del botón «Entregar desenlaces»: ahora entrega un job, y
   * lo que un operador necesita saber es si ese job está haciendo su trabajo — cuántos esperan,
   * desde cuándo, cuántos se quedaron por el camino — y dónde se MIDE lo entregado (en el Motor).
   */
  async summarize(tenantId: string | null) {
    const scope = tenantId ? { tenantId } : {};
    const [pending, failed, exhausted, sent, oldestPending, lastSent] = await Promise.all([
      this.reportModel.count({ where: { ...scope, status: 'pending' } }),
      this.reportModel.count({ where: { ...scope, status: 'failed', attempts: { [Op.lt]: MAX_ATTEMPTS } } }),
      this.reportModel.count({ where: { ...scope, status: 'failed', attempts: { [Op.gte]: MAX_ATTEMPTS } } }),
      this.reportModel.count({ where: { ...scope, status: 'sent' } }),
      this.reportModel.min<Date | null, LoanOutcomeReportModel>('observedAt', { where: { ...scope, status: 'pending' } }),
      this.reportModel.max<Date | null, LoanOutcomeReportModel>('sentAt', { where: { ...scope, status: 'sent' } }),
    ]);
    return {
      pending,
      retrying: failed,
      exhausted,
      sent,
      oldestPendingObservedAt: oldestPending ?? null,
      lastSentAt: lastSent ?? null,
      configured: this.client.canReportOutcomes,
      maxAttempts: MAX_ATTEMPTS,
    };
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
