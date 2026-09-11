/**
 * @file Repositorio de la capa de datos: encapsula el acceso a PostgreSQL.
 * @business Esta pieza deja registro de cada carga del artefacto de Flujos y evita que dos se pisen.
 * @system consulta el histórico de cargas y toma el cerrojo por (alcance, bloque) dentro de la transacción.
 */
import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { Transaction } from 'sequelize';
import { SystemFlowImportModel } from '../../database/models/system-flow-imports.model.js';

@Injectable()
export class SystemFlowsImportsRepository {
  constructor(@InjectModel(SystemFlowImportModel) private readonly imports: typeof SystemFlowImportModel) {}

  /**
   * Las últimas cargas, filtrables por bloque y alcance. Sin filtro se cortaba en 30 filas, y una carga completa ocupa
   * 18: unas pocas recargas de un bloque sacaban a los demás de la ventana, y quien comprobaba «¿retrocede?» no
   * encontraba su última carga y seguía sin comparar nada.
   */
  latestImports(query: { systemCode?: string; scope?: string; limit?: number } = {}): Promise<SystemFlowImportModel[]> {
    return this.imports.findAll({
      where: { ...(query.systemCode ? { systemCode: query.systemCode } : {}), ...(query.scope ? { scope: query.scope } : {}) },
      order: [['createdAtValue', 'DESC']],
      limit: query.limit ?? 30,
    });
  }

  /**
   * Cerrojo por (alcance, bloque) dentro de la transacción: dos cargas a la vez del mismo bloque leían las dos la misma
   * fecha del artefacto anterior, las dos pasaban la comprobación de retroceso y ganaba la que confirmaba última, que
   * podía ser la más vieja. Lo suelta PostgreSQL al terminar la transacción.
   */
  async lockScope(scope: string, systemCode: string, tx: Transaction): Promise<void> {
    await this.imports.sequelize!.query('SELECT pg_advisory_xact_lock(hashtext($1))', {
      bind: [`flujos:${scope}:${systemCode}`],
      transaction: tx,
    });
  }
}
