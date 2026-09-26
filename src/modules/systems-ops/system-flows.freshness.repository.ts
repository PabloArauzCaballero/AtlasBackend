/**
 * @file Repositorio de la capa de datos: encapsula el acceso a PostgreSQL.
 * @business Esta pieza mantiene creíble el aviso de «este flujo cambió desde que se verificó».
 * @system compara la huella del código de cada flujo con la que trae la recarga.
 */
import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { Op, Transaction } from 'sequelize';
import { SystemFlowCatalogModel } from '../../database/models/system-flow-catalog.model.js';

/**
 * La frescura del catálogo, separada del repositorio de flujos.
 *
 * Es un eje con vida propia —lo escribe la RECARGA, no la verificación— y su regla no se parece a
 * ninguna otra del repositorio: compara dos huellas y decide sobre una fecha. Tenerlo aparte
 * también deja claro quién puede marcar STALE, que es exactamente un sitio.
 */
@Injectable()
export class SystemFlowsFreshnessRepository {
  constructor(@InjectModel(SystemFlowCatalogModel) private readonly flows: typeof SystemFlowCatalogModel) {}

  /**
   * Marca STALE los flujos cuyo CÓDIGO cambió desde la última carga, y sólo ésos.
   *
   * Se compara la huella guardada con la que trae la recarga. Un flujo sin huella guardada no se
   * toca: significa «no consta», y suponerlo desactualizado inundaría el panel el primer día.
   *
   * Devuelve CUÁLES cambiaron. Su número es lo que hace útil la recarga —qué parte del bloque se movió
   * de verdad—, y la lista es lo que devuelve a la cola de revisión lo que se aprobó sobre el código viejo.
   */
  async markStaleByDepsHash(
    systemCode: string,
    rows: ReadonlyArray<{ flowId: string; depsHash: string | null }>,
    tx: Transaction,
  ): Promise<string[]> {
    const entrantes = new Map(rows.map((row) => [row.flowId, row.depsHash]));
    const guardados = await this.flows.findAll({
      where: { systemCode },
      attributes: ['flowId', 'depsHash'],
      transaction: tx,
    });
    const cambiados = guardados
      .filter((fila) => fila.depsHash && entrantes.get(fila.flowId) && entrantes.get(fila.flowId) !== fila.depsHash)
      .map((fila) => fila.flowId);
    if (!cambiados.length) return [];
    // Se anota CUÁNDO cambió: sin eso, «desactualizado» no se puede apagar con criterio. Una corrida
    // anterior al cambio ejercitó el código viejo y no dice nada del nuevo.
    await this.flows.update(
      { freshness: 'STALE', depsChangedAt: new Date() },
      { where: { flowId: { [Op.in]: cambiados } }, transaction: tx },
    );
    return cambiados;
  }
}
