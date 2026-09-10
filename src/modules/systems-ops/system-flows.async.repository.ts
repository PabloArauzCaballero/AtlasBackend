/**
 * @file Repositorio de la capa de datos: encapsula el acceso a PostgreSQL.
 * @business Esta pieza hace visible el trabajo que un flujo deja encargado y nadie recoge.
 * @system cruza los eventos escritos con la petición que los originó, por correlación.
 */
import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { QueryTypes } from 'sequelize';
import { SystemFlowCatalogModel } from '../../database/models/system-flow-catalog.model.js';
import { PENDING_WORK_SQL } from './system-flows.sql.constants.js';

/** Lo que un flujo dejó encargado en una ventana, y qué pasó con ello. */
export interface PendingWorkRow {
  method: string;
  path: string;
  events: string;
  pending: string;
  processed: string;
  other: string;
  pending_since: Date | null;
  codes: string[];
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
}
