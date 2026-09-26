/**
 * @file Repositorio de la capa de datos: encapsula el acceso a PostgreSQL.
 * @business Esta pieza hace visible el trabajo que un flujo deja encargado y nadie recoge.
 * @system cruza los eventos escritos con la petición que los originó, por correlación.
 */
import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { QueryTypes } from 'sequelize';
import { SystemFlowCatalogModel } from '../../database/models/system-flow-catalog.model.js';
import { DOMAIN_EVENT_CONSUMERS_SQL, OUTBOX_HEALTH_SQL, PENDING_WORK_SQL } from './system-flows.sql.constants.js';

/** Lo que un flujo dejó encargado en una ventana, y qué pasó con ello. */
export interface PendingWorkRow {
  method: string;
  path: string;
  events: string;
  pending: string;
  processed: string;
  failed: string;
  other: string;
  pending_without_tenant: string;
  pending_since: Date | null;
  last_processed_at: Date | null;
  codes: string[];
}

/** Un código de evento de dominio en la ventana, con cuántos de sus eventos acabaron en un aviso. */
export interface DomainEventRow {
  event_code: string;
  aggregate_types: string[] | null;
  events: string;
  processed: string;
  failed: string;
  events_with_message: string;
  messages: string;
  messages_sent: string;
  last_event_at: Date | null;
}

/** El outbox entero y el consumidor, sin pasar por la atribución a una petición. */
export interface OutboxHealthRow {
  pending: string;
  pending_without_tenant: string;
  failed: string;
  oldest_pending: Date | null;
  consumer_last_run: Date | null;
}

/**
 * Lo asíncrono, separado del repositorio de flujos.
 *
 * Es otra fuente y otra pregunta: el catálogo dice qué hace un flujo mientras responde, y esto dice
 * qué deja encargado para después. Mezclarlos en el mismo repositorio haría crecer un fichero que ya
 * está en el tope, y confundiría dos evidencias que no se recogen igual.
 */
@Injectable()
export class SystemFlowsAsyncRepository {
  constructor(@InjectModel(SystemFlowCatalogModel) private readonly flows: typeof SystemFlowCatalogModel) {}

  pendingWork(windowDays: number): Promise<PendingWorkRow[]> {
    return this.flows.sequelize!.query<PendingWorkRow>(PENDING_WORK_SQL, {
      type: QueryTypes.SELECT,
      replacements: { windowDays: String(windowDays) },
    });
  }

  async outboxHealth(): Promise<OutboxHealthRow> {
    const [fila] = await this.flows.sequelize!.query<OutboxHealthRow>(OUTBOX_HEALTH_SQL, { type: QueryTypes.SELECT });
    return fila;
  }

  domainEventConsumers(windowDays: number): Promise<DomainEventRow[]> {
    return this.flows.sequelize!.query<DomainEventRow>(DOMAIN_EVENT_CONSUMERS_SQL, {
      type: QueryTypes.SELECT,
      replacements: { windowDays: String(windowDays) },
    });
  }
}
