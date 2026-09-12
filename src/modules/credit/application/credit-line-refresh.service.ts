/**
 * @file Servicio de aplicación o dominio: ejecuta reglas y coordina dependencias.
 * @business Esta pieza mantiene viva la capacidad de pago del cliente sin que nadie tenga que pedirla.
 * @system barre clientes sin línea o con línea vieja y le pide al motor que la recalcule.
 */
import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { FindOptions, Op } from 'sequelize';
import { CreditLineModel, CustomerModel } from '../../../database/models/index.js';
import { CreditLineService, type CalculationTrigger } from './credit-line.service.js';

/**
 * El recálculo automático de la línea de crédito.
 *
 * ## Qué agujero tapa
 *
 * La línea la calculaba el motor —eso ya estaba bien— pero SÓLO cuando alguien la pedía a mano
 * desde operaciones o cuando se aplicaba un extracto bancario. Es decir: en la práctica, casi
 * nunca. Un cliente recién dado de alta se quedaba sin línea hasta que un operador se acordara de
 * él, y la app le enseñaba «sin calcular» encima de una cuenta ya aprobada.
 *
 * ## Dos motivos para volver a preguntar
 *
 * **No tiene línea.** Es el alta: el expediente ya está completo y verificado, así que la política
 * ya puede pronunciarse. Nadie debería tener que pedir su propio límite.
 *
 * **La tiene vieja.** El expediente no deja de moverse cuando se calcula la línea —cambian ingresos,
 * se verifican contactos, se completan documentos— y ninguna de esas cosas pasa por crédito. Sin un
 * corte por antigüedad, la línea responde a la persona que era y no a la que es.
 *
 * La mora y los pagos NO entran aquí: los detecta el barrido de mora, que es quien sabe cuándo
 * cambió el tramo, y dispara su propio recálculo con ese motivo.
 *
 * ## Por qué hay un tope por pasada
 *
 * Cada cliente es una llamada al motor. Sin tope, un alta masiva —o la primera corrida sobre una
 * cartera existente— se convertiría en una tormenta de peticiones contra el servicio del que depende
 * toda decisión de crédito. Con tope, la cola se drena en varias pasadas y el motor nunca ve un
 * pico que no pidió nadie.
 */
@Injectable()
export class CreditLineRefreshService {
  private readonly logger = new Logger(CreditLineRefreshService.name);

  constructor(
    @InjectModel(CustomerModel) private readonly customers: typeof CustomerModel,
    @InjectModel(CreditLineModel) private readonly creditLines: typeof CreditLineModel,
    private readonly lines: CreditLineService,
  ) {}

  async refreshStaleLines(input: { tenantId: string; maxAgeDays: number; limit: number; now?: Date }): Promise<{
    missing: number;
    stale: number;
    recalculated: number;
    failed: number;
  }> {
    const now = input.now ?? new Date();
    const threshold = new Date(now.getTime() - input.maxAgeDays * 24 * 60 * 60 * 1000);

    const withCurrentLine = await this.creditLines.findAll({
      where: { tenantId: input.tenantId, validUntil: null, deleted: false },
      attributes: ['customerId', 'validFrom'],
    } as FindOptions);

    const current = new Map(withCurrentLine.map((line) => [line.customerId, line.validFrom]));

    /*
     * Sólo clientes `active`. Uno en alta a medias todavía no tiene expediente que evaluar, y pedir
     * su línea produciría un rechazo por datos ausentes que luego se le enseña como si la política
     * lo hubiera valorado y dicho que no.
     */
    const eligible = await this.customers.findAll({
      where: { tenantId: input.tenantId, lifecycleStatus: 'active', deleted: { [Op.not]: true } },
      attributes: ['id'],
    } as FindOptions);

    const missingIds: string[] = [];
    const staleIds: string[] = [];
    for (const customer of eligible) {
      const validFrom = current.get(customer.id);
      if (!validFrom) missingIds.push(customer.id);
      else if (new Date(validFrom).getTime() < threshold.getTime()) staleIds.push(customer.id);
    }

    // Primero quien no tiene nada: entre «a este no le hemos dicho cuánto puede gastar» y «la cifra
    // de este tiene un mes», la primera es la que el cliente está mirando ahora mismo en la app.
    const queue: Array<{ customerId: string; trigger: CalculationTrigger }> = [
      ...missingIds.map((customerId) => ({ customerId, trigger: 'onboarding' as CalculationTrigger })),
      ...staleIds.map((customerId) => ({ customerId, trigger: 'manual' as CalculationTrigger })),
    ].slice(0, input.limit);

    let recalculated = 0;
    let failed = 0;
    for (const item of queue) {
      try {
        const line = await this.lines.recalculate({ tenantId: input.tenantId, customerId: item.customerId, trigger: item.trigger });
        if (line) recalculated += 1;
        else failed += 1;
      } catch (error) {
        failed += 1;
        this.logger.error(`No se pudo calcular la línea del cliente ${item.customerId}: ${(error as Error).message}`);
      }
    }

    return { missing: missingIds.length, stale: staleIds.length, recalculated, failed };
  }
}
