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
import { FacilityOutcomeInput, FacilityRegistrationInput } from './decision-engine.types.js';

/** Tras varios intentos fallidos se deja de reintentar solo y se pide mirada humana. */
const MAX_ATTEMPTS = 6;

@Injectable()
export class OutcomeDispatchService {
  private readonly logger = new Logger(OutcomeDispatchService.name);

  constructor(
    private readonly client: DecisionEngineClient,
    @InjectModel(LoanOutcomeReportModel) private readonly reportModel: typeof LoanOutcomeReportModel,
    @InjectModel(LoanModel) private readonly loanModel: typeof LoanModel,
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
       * El ALTA del crédito va antes del desenlace, y en la misma pasada.
       *
       * `/v1/outcomes/batch` exige que el crédito exista en el motor: sin eso rechaza la fila con
       * `FACILITY_NOT_FOUND`. El alta ocurre al desembolsar, pero puede haber fallado —el motor
       * caído, o un préstamo anterior a la integración—, y entonces sus desenlaces no entrarían
       * nunca y su ventana no se cerraría jamás. Reintentarla aquí es barato porque es idempotente
       * en el motor (`upsert` por referencia, sin reasignar el sujeto), y convierte este barrido en
       * la red que recupera lo que el desembolso no pudo dejar registrado.
       */
      await this.registrarCreditos(enviables, codigoPorPrestamo, loans);

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
   * Da de alta en el motor los créditos de este lote que aún no lo estén.
   *
   * No se pregunta primero si están: el alta es un `upsert` idempotente y preguntar costaría una
   * llamada por préstamo para ahorrar una que ya es barata. Los préstamos sin `decisionExecutionId`
   * se omiten —el motor toma el sujeto de esa decisión y no se puede añadir después—, y sus
   * desenlaces serán rechazados con su motivo, que es la respuesta honesta: ese crédito no se puede
   * atribuir a nadie.
   *
   * Un fallo aquí NO detiene el envío: el motor puede tener ya registrados los créditos de una
   * pasada anterior, y renunciar a entregar los desenlaces por no haber podido reconfirmar el alta
   * dejaría la cobertura sin moverse por un problema que quizá no existe.
   */
  private async registrarCreditos(
    reports: readonly LoanOutcomeReportModel[],
    codigoPorPrestamo: Map<string, string>,
    loans: readonly LoanModel[],
  ): Promise<void> {
    const porId = new Map(loans.map((loan) => [String(loan.id), loan]));
    const vistos = new Set<string>();
    const altas: FacilityRegistrationInput[] = [];
    for (const report of reports) {
      const loan = porId.get(String(report.loanId));
      const codigo = codigoPorPrestamo.get(String(report.loanId));
      if (!loan || !codigo || vistos.has(codigo)) continue;
      if (!loan.decisionExecutionId) continue;
      vistos.add(codigo);
      altas.push({
        externalReference: codigo,
        originationExecutionId: loan.decisionExecutionId,
        principalAmount: Number(loan.principalAmount),
        currencyCode: loan.currencyCode,
        termMonths: loan.termMonths,
        annualRate: Number(loan.annualInterestRate),
        ...(loan.disbursedAt ? { disbursedAt: loan.disbursedAt.toISOString() } : {}),
      });
    }
    if (altas.length === 0) return;
    try {
      const veredictos = await this.client.registerFacilities(altas);
      const rechazados = veredictos.filter((row) => !row.accepted);
      if (rechazados.length > 0) {
        this.logger.warn(
          `El motor no aceptó el alta de ${rechazados.length} créditos: ` +
            rechazados.map((row) => `${row.externalReference} (${row.reason ?? 'sin motivo'})`).join(', '),
        );
      }
    } catch (error) {
      this.logger.warn(
        `No se pudo reconfirmar el alta de ${altas.length} créditos en el motor: ${(error as Error).message}. ` +
          'Se intenta entregar los desenlaces igualmente: puede que ya estuvieran registrados.',
      );
    }
  }

  /**
   * Da de alta en el motor los créditos concedidos que todavía no lo están.
   *
   * ## Por qué es una pasada propia y no parte del desembolso
   *
   * El libro de préstamos no tiene permitido depender de este módulo
   * (`config/architecture/boundaries.json`: `loans` sólo puede apoyarse en `credit`), y con razón —
   * el libro no debería necesitar al motor para poder desembolsar—. Así que el alta la hace quien
   * conoce el contrato del motor, que es este servicio.
   *
   * Se pierde inmediatez y NO se pierde exactitud: el motor fecha las ventanas de observación desde
   * la DECISIÓN y no desde el alta, así que registrar un rato más tarde no corre ninguna ventana.
   *
   * ## Por qué no espera a que haya desenlaces
   *
   * Porque entonces un crédito recién desembolsado —que todavía no tiene desenlace— no estaría en el
   * motor, y ésa es exactamente la población que una cosecha JOVEN necesita para existir. Una matriz
   * de cosechas que sólo contiene créditos con desenlace ya cargado no mide una cartera: mide la
   * parte de la cartera que alguien ya reportó.
   *
   * ## La marca
   *
   * `decision_facility_registered_at` hace la pasada incremental. Sin ella habría que reenviar la
   * cartera entera en cada barrido —idempotente pero creciendo para siempre— y la pregunta «¿qué
   * créditos no puede medir el motor?» no tendría respuesta en una consulta.
   *
   * Un crédito que el motor RECHAZA no se marca: quedará en la cola. Es correcto — un rechazo por
   * `EXECUTION_WITHOUT_SUBJECT` no se arregla reintentando, pero marcarlo lo escondería, y lo que
   * hace falta es que se vea que hay créditos que el motor nunca podrá medir.
   */
  async registrarCreditosNuevos(input: { tenantId: string | null; limit: number }) {
    if (!this.client.canReportOutcomes) {
      return { registrados: 0, rechazados: 0, reason: 'DECISION_ENGINE_OUTCOME_KEY_NOT_CONFIGURED' as const };
    }

    const pendientes = await this.loanModel.findAll({
      where: {
        decisionFacilityRegisteredAt: null,
        decisionExecutionId: { [Op.ne]: null },
        disbursedAt: { [Op.ne]: null },
        ...(input.tenantId ? { tenantId: input.tenantId } : {}),
      },
      order: [['disbursedAt', 'ASC']],
      limit: input.limit,
    } as FindOptions);
    if (pendientes.length === 0) return { registrados: 0, rechazados: 0 };

    const altas: FacilityRegistrationInput[] = pendientes.map((loan) => ({
      externalReference: loan.loanCode,
      originationExecutionId: loan.decisionExecutionId as string,
      principalAmount: Number(loan.principalAmount),
      currencyCode: loan.currencyCode,
      termMonths: loan.termMonths,
      // Tanto por uno, no porcentaje: el libro ya guarda la tasa anual así, y mandar 28 en vez de
      // 0,28 pasaría la validación del motor y multiplicaría por cien lo que se calcule con ella.
      annualRate: Number(loan.annualInterestRate),
      ...(loan.disbursedAt ? { disbursedAt: loan.disbursedAt.toISOString() } : {}),
    }));

    try {
      const veredictos = await this.client.registerFacilities(altas);
      const aceptados = new Set(veredictos.filter((row) => row.accepted).map((row) => row.externalReference));
      const now = new Date();
      let registrados = 0;
      for (const loan of pendientes) {
        if (!aceptados.has(loan.loanCode)) continue;
        loan.decisionFacilityRegisteredAt = now;
        await loan.save();
        registrados += 1;
      }
      const rechazos = veredictos.filter((row) => !row.accepted);
      if (rechazos.length > 0) {
        this.logger.warn(
          `El motor no aceptó ${rechazos.length} créditos: ` +
            rechazos.map((row) => `${row.externalReference} (${row.reason ?? 'sin motivo'})`).join(', '),
        );
      }
      return { registrados, rechazados: rechazos.length };
    } catch (error) {
      /*
       * No se marca NADA si la llamada falla: el motor pudo no recibir el lote, y marcar un crédito
       * como registrado sin que lo esté lo saca de la cola para siempre — sus desenlaces se
       * rechazarían después con `FACILITY_NOT_FOUND` y nadie sabría por qué.
       */
      this.logger.error(`No se pudo registrar el lote de ${altas.length} créditos: ${(error as Error).message}`);
      return { registrados: 0, rechazados: altas.length };
    }
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
