/**
 * @file Repositorio de solo lectura: consultas de actividad para el tablero de proveedores externos.
 * @business Esta pieza incorpora evidencia KYC, financiera y de confianza con control de costo, consentimiento y disponibilidad.
 * @system aísla proveedores detrás de adaptadores resilientes y políticas de gobierno, ejecución y evidencia.
 */
import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { Op } from 'sequelize';
import { DataProviderRequestModel, ProviderHealthLogModel } from '../../../database/models/index.js';

/**
 * Un chequeo CONTÓ como medición.
 *
 * `checkMockHealth` sólo sale a la red en `mock_server`; en los demás modos —`mock_local`, y hoy
 * también `sandbox` y `production`, cuyos adaptadores no tienen integración real— devuelve `UP` con
 * `latencyMs: 0` sin llamar a nadie. Esas filas registran una comprobación que no ocurrió, y la
 * serie del tablero las dibujaba como una línea plana en cero: el mismo «responde al instante» que
 * se quitó de la tabla.
 *
 * Las tres condiciones hacen falta y ninguna sobra:
 *
 * - `mock_server` entra SIEMPRE, aunque la latencia salga 0. Se calcula con `Date.now() - started`
 *   y el health del emulador no duerme: es un ida y vuelta local. Medido contra el VPS el
 *   2026-09-10, los ocho dieron entre 1 y 49 ms — con la máquina descargada, redondear a 0 es
 *   cuestión de tiempo, y filtrar sólo por latencia habría empezado a tirar mediciones buenas sin
 *   que nadie lo notara.
 * - La latencia positiva entra aunque el modo no sea `mock_server`, para que el día que
 *   `production` mida de verdad esto se vuelva cierto solo, sin que nadie recuerde tocar una lista.
 * - El código de error entra porque un fallo SÍ es una medición: es la mitad de la serie que
 *   importa.
 */
const MEDICION_REAL = {
  [Op.or]: [{ modeChecked: 'mock_server' }, { latencyMs: { [Op.gt]: 0 } }, { errorCode: { [Op.ne]: null } }],
};

/**
 * Vive APARTE de `ExternalDataRepository` por el trinquete `check:file-size` (ese archivo está en
 * el baseline y no puede crecer) y porque su naturaleza es distinta: aquí no se escribe nada, son
 * lecturas agregadas para pintar una pantalla.
 *
 * `provider_health_logs` se venía ESCRIBIENDO desde 2026-07 en cada carga de la tabla del portal y
 * NADIE la leía nunca. La serie de salud del tablero sale de ahí: el dato ya estaba, faltaba
 * consultarlo.
 */
@Injectable()
export class ExternalProviderDashboardRepository {
  constructor(
    @InjectModel(DataProviderRequestModel) private readonly requestModel: typeof DataProviderRequestModel,
    @InjectModel(ProviderHealthLogModel) private readonly healthLogModel: typeof ProviderHealthLogModel,
  ) {}

  /**
   * Últimos chequeos de salud de un proveedor, del más reciente al más antiguo. El tablero los
   * invierte para dibujar la serie de izquierda a derecha.
   */
  listRecentHealthLogs(providerId: string, limit: number): Promise<ProviderHealthLogModel[]> {
    return this.healthLogModel.findAll({
      // Sólo los chequeos que MIDIERON algo: ver `MEDICION_REAL`. Sin este filtro la serie dibuja
      // los veredictos constantes como una línea plana en cero, que se lee «responde al instante»
      // — la afirmación falsa que se quitó de la tabla. Medido el 2026-09-10 en el VPS: 296 filas
      // así, todas anteriores a pasar los proveedores a `mock_server`.
      where: { providerId, ...MEDICION_REAL },
      order: [['checked_at', 'DESC']],
      limit,
    });
  }

  /**
   * Solicitudes de una ventana, para agregar por proveedor. Sin `tenantId` cruza todos los
   * inquilinos: es una pantalla de plataforma, y así está resuelto ya en los reportes de SLA y uso.
   */
  listRequestsInWindow(input: { from: Date; tenantId?: string; providerId?: string; limit?: number }): Promise<DataProviderRequestModel[]> {
    const where: Record<string, unknown> = { requestedAt: { [Op.gte]: input.from } };
    if (input.tenantId) where.tenantId = input.tenantId;
    if (input.providerId) where.providerId = input.providerId;
    return this.requestModel.findAll({ where, order: [['requested_at', 'DESC']], limit: input.limit ?? 5000 });
  }

  /**
   * Listado paginado para la pantalla de Solicitudes.
   *
   * El backend NO exponía ningún listado, y por eso esa pantalla pide identificadores a ciegas:
   * el propio texto de la pantalla dice «el ID se obtiene de otra pantalla». Con esto deja de ser
   * cierto.
   */
  async listRequestsPage(input: {
    from: Date;
    tenantId?: string;
    providerId?: string;
    customerId?: string;
    responseStatuses?: string[];
    approvalStatus?: string;
    limit: number;
    offset: number;
  }): Promise<{ rows: DataProviderRequestModel[]; count: number }> {
    const where: Record<string, unknown> = { requestedAt: { [Op.gte]: input.from } };
    if (input.tenantId) where.tenantId = input.tenantId;
    if (input.providerId) where.providerId = input.providerId;
    if (input.customerId) where.customerId = input.customerId;
    if (input.responseStatuses?.length) where.responseStatus = { [Op.in]: input.responseStatuses };
    if (input.approvalStatus) where.approvalStatus = input.approvalStatus;
    // `findAndCountAll` y no dos consultas: el total tiene que ser el de ESTE filtro, y contarlo
    // aparte abre la puerta a que el conteo y la página discrepen si entra una solicitud entre
    // ambas.
    const result = await this.requestModel.findAndCountAll({
      where,
      order: [['requested_at', 'DESC']],
      limit: input.limit,
      offset: input.offset,
    });
    return { rows: result.rows, count: result.count };
  }
}
