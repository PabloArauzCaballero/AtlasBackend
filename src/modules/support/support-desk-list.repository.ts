/**
 * @file Puerto de persistencia: las dos listas de la mesa del agente.
 * @business Deja al agente buscar y recorrer la cola de espera y sus propias conversaciones, con sus cifras.
 * @system lee `support_channels` (nunca escribe): páginas con total del filtro y resúmenes del alcance entero.
 */
import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { Op } from 'sequelize';
import { withTextSearch } from '../../common/utils/query/text-search.util.js';
import { SupportChannelModel } from '../../database/models/index.js';
import { SUPPORT_ASSIGNED_CHANNEL_STATUSES } from './support.constants.js';

/** Una página de una lista de la mesa: filas a saltar y a traer, y el buscador. */
export type ChannelListPage = { limit: number; offset: number; q?: string };

/**
 * Lo que la consola pinta como tablas: «en espera» y «mis conversaciones».
 *
 * Vive aparte de `SupportChannelRepository` —que abre, asigna y cierra canales— porque éstas son sólo
 * lecturas paginadas y crecían hasta pasar el tope de tamaño del repositorio de escritura.
 */
@Injectable()
export class SupportDeskListRepository {
  constructor(@InjectModel(SupportChannelModel) private readonly channels: typeof SupportChannelModel) {}

  /**
   * La cola de espera: canales encolados sin agente, en orden de llegada, con el total del filtro.
   *
   * `q` busca por partes en el código de la conversación, su n.º, el n.º del expediente y el tipo de
   * canal —lo que el listado enseña—, con `%` y `_` como texto literal.
   */
  listQueuedChannels(
    tenantId: string,
    queueId: string | null,
    page: ChannelListPage & { channelType?: string },
  ): Promise<{ rows: SupportChannelModel[]; count: number }> {
    const where: Record<string | symbol, unknown> = {
      tenantId,
      deleted: false,
      status: { [Op.in]: ['REQUESTED', 'QUEUED'] },
      ...(queueId ? { queueId } : {}),
      ...(page.channelType ? { channelType: page.channelType } : {}),
    };
    withTextSearch(where, page.q, ['channelCode', 'channelType'], ['_id', 'case_id']);
    return this.channels.findAndCountAll({
      where,
      order: [
        ['requested_at', 'ASC'],
        ['_id', 'ASC'],
      ],
      limit: page.limit,
      offset: page.offset,
    });
  }

  /** Cuántos esperan, cuántos sin expediente y desde cuándo el más antiguo: de TODA la cola, sin búsqueda ni página. */
  async summarizeQueued(tenantId: string, queueId: string | null) {
    const where = {
      tenantId,
      deleted: false,
      status: { [Op.in]: ['REQUESTED', 'QUEUED'] },
      ...(queueId ? { queueId } : {}),
    };
    const [total, withoutCase, oldest] = await Promise.all([
      this.channels.count({ where }),
      this.channels.count({ where: { ...where, caseId: null } }),
      this.channels.min<Date | null, SupportChannelModel>('requestedAt', { where }),
    ]);
    return { total, withoutCase, oldestRequestedAt: oldest ?? null };
  }

  /**
   * Las conversaciones vivas que lleva este agente, la más reciente primero, con el total del filtro.
   *
   * Sin esta lista, un chat que el enrutado asignó solo —agente en `AVAILABLE`— salía de «en espera»
   * y no aparecía en ningún otro sitio de la consola: el agente lo tenía y no lo veía.
   */
  listAssignedChannels(
    tenantId: string,
    agentProfileId: string,
    page: ChannelListPage & { channelType?: string; status?: string },
  ): Promise<{ rows: SupportChannelModel[]; count: number }> {
    const where: Record<string | symbol, unknown> = {
      tenantId,
      deleted: false,
      assignedAgentProfileId: agentProfileId,
      status: page.status ?? { [Op.in]: [...SUPPORT_ASSIGNED_CHANNEL_STATUSES] },
      ...(page.channelType ? { channelType: page.channelType } : {}),
    };
    withTextSearch(where, page.q, ['channelCode', 'channelType'], ['_id', 'case_id']);
    return this.channels.findAndCountAll({
      where,
      order: [
        ['last_activity_at', 'DESC'],
        ['_id', 'DESC'],
      ],
      limit: page.limit,
      offset: page.offset,
    });
  }

  /** Cuántas llevo, cuántas esperan mi respuesta y cuántas no tienen expediente: de TODAS las mías. */
  async summarizeAssigned(tenantId: string, agentProfileId: string) {
    const where = {
      tenantId,
      deleted: false,
      assignedAgentProfileId: agentProfileId,
      status: { [Op.in]: [...SUPPORT_ASSIGNED_CHANNEL_STATUSES] },
    };
    const [total, waitingAgent, withoutCase] = await Promise.all([
      this.channels.count({ where }),
      this.channels.count({ where: { ...where, status: 'WAITING_AGENT' } }),
      this.channels.count({ where: { ...where, caseId: null } }),
    ]);
    return { total, waitingAgent, withoutCase };
  }
}
