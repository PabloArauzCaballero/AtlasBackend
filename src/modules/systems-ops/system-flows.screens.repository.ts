/**
 * @file Repositorio de la capa de datos: encapsula el acceso a PostgreSQL.
 * @business Esta pieza permite saber qué pantallas del ecosistema se usan de verdad y contra qué llaman.
 * @system lee y escribe el catálogo de pantallas y las corridas observadas por origen.
 */
import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { QueryTypes, Transaction } from 'sequelize';
import { SystemScreenCatalogModel } from '../../database/models/system-screen-catalog.model.js';
import { SCREEN_RUNS_SQL } from './system-flows.sql.constants.js';
import { ScreenRuns } from './system-flows.verification.util.js';

/**
 * Todo lo que Flujos sabe de las PANTALLAS, separado del repositorio de flujos.
 *
 * No es una división estética: son dos catálogos con ciclos de vida distintos —uno se recarga desde
 * el análisis del código de los backends, el otro desde el de los clientes— y la única consulta que
 * los une (qué se llamó desde dónde) no pertenece a ninguno de los dos por completo. Mantenerlos
 * juntos hacía crecer un fichero que ya estaba en el tope, y el tope existe para esto.
 */
@Injectable()
export class SystemFlowsScreensRepository {
  constructor(@InjectModel(SystemScreenCatalogModel) private readonly screens: typeof SystemScreenCatalogModel) {}

  /**
   * Qué se hizo desde cada pantalla en la ventana, indexado por su ruta.
   *
   * Sólo aparecen las pantallas cuyo cliente DECLARÓ su origen. Una pantalla ausente de este mapa no
   * es una pantalla rota: es una que nadie abrió, o una cuyo cliente todavía no manda la cabecera.
   */
  async screenRuns(windowDays: number): Promise<Map<string, ScreenRuns>> {
    const rows = await this.screens.sequelize!.query<{
      screen: string;
      calls: string;
      failed: string;
      last_at: Date | null;
      routes: Array<{ method: string; path: string; calls: number; failed: number }>;
    }>(SCREEN_RUNS_SQL, { type: QueryTypes.SELECT, replacements: { windowDays: String(windowDays) } });
    const out = new Map<string, ScreenRuns>();
    for (const row of rows) {
      out.set(row.screen, {
        calls: Number(row.calls),
        failed: Number(row.failed),
        lastAt: row.last_at ? new Date(row.last_at) : null,
        routes: row.routes ?? [],
      });
    }
    return out;
  }

  /** Escribe el desenlace de una pantalla dentro de la transacción que recibe. */
  async applyScreenVerification(
    clientCode: string,
    route: string,
    outcome: { verification: string; lastSeenAt: Date | null; observed: Record<string, unknown> },
    tx: Transaction,
  ): Promise<void> {
    await this.screens.update(
      {
        verification: outcome.verification,
        verifiedAt: new Date(),
        lastSeenAt: outcome.lastSeenAt,
        observed: outcome.observed,
      },
      { where: { clientCode, route }, transaction: tx },
    );
  }

  /** Los códigos de cliente que hay en el catálogo de pantallas, sin suponer cuáles son. */
  async screenClients(): Promise<string[]> {
    const rows = await this.screens.findAll({
      attributes: ['clientCode'],
      group: ['client_code'],
      order: [['clientCode', 'ASC']],
      raw: true,
    });
    return (rows as unknown as Array<{ clientCode: string }>).map((row) => row.clientCode);
  }

  /** Las pantallas de un cliente, con lo mínimo para cruzarlas y escribir su desenlace. */
  screensOfClient(clientCode: string): Promise<SystemScreenCatalogModel[]> {
    return this.screens.findAll({
      where: { clientCode },
      attributes: ['clientCode', 'route', 'verification'],
      order: [['route', 'ASC']],
    });
  }
}
