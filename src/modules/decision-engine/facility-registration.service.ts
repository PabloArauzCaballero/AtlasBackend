/**
 * @file Servicio de aplicación: da de alta en el motor los créditos que concedió el core.
 * @business Sin el crédito registrado, el motor no puede medir si acertó al aprobarlo.
 * @system recorre los préstamos desembolsados sin marca de alta y los registra, en lotes.
 */
import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { FindOptions, Op } from 'sequelize';
import { LoanModel } from '../../database/models/index.js';
import { DecisionEngineClient } from './decision-engine.client.js';
import { FacilityRegistrationInput } from './decision-engine.types.js';

/**
 * El alta del crédito en el motor, en su propio servicio y con su propio job.
 *
 * ## Por qué no la hace el desembolso
 *
 * El libro de préstamos no tiene permitido depender de este módulo
 * (`config/architecture/boundaries.json`: `loans` sólo se apoya en `credit`), y la regla acierta: el
 * libro no debería necesitar al motor para poder entregar dinero. Así que el alta la hace quien
 * conoce el contrato del motor.
 *
 * Se pierde inmediatez y NO se pierde exactitud: el motor fecha las ventanas de observación desde la
 * DECISIÓN y no desde el alta, así que registrar un rato más tarde no corre ninguna ventana.
 *
 * ## Por qué no espera a que haya desenlaces
 *
 * Porque un crédito recién desembolsado todavía no tiene desenlace, y ésa es exactamente la
 * población que una cosecha JOVEN necesita para existir. Una matriz de cosechas que sólo contiene
 * créditos con desenlace ya cargado no mide una cartera: mide la parte que alguien ya reportó.
 */
@Injectable()
export class FacilityRegistrationService {
  private readonly logger = new Logger(FacilityRegistrationService.name);

  constructor(
    private readonly client: DecisionEngineClient,
    @InjectModel(LoanModel) private readonly loanModel: typeof LoanModel,
  ) {}

  /**
   * Registra los créditos pendientes de alta, del más antiguo al más nuevo.
   *
   * `decision_facility_registered_at` hace la pasada incremental: sin la marca habría que reenviar
   * la cartera entera en cada barrido —idempotente, pero creciendo para siempre— y la pregunta «¿qué
   * créditos no puede medir el motor?» no tendría respuesta en una consulta.
   *
   * Un crédito que el motor RECHAZA no se marca: se queda en la cola. Es deliberado — un
   * `EXECUTION_WITHOUT_SUBJECT` no se arregla reintentando, pero marcarlo lo esconderría, y lo que
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
}
