import { QueryTypes } from 'sequelize';
import { Sequelize } from 'sequelize-typescript';
import { intValue, Row } from './portal-format.util.js';

/**
 * Base común de los servicios de consulta del portal interno.
 *
 * Extraída de `internal-portal.service.ts` (Fase 2.2 del plan 10/10): `queryRows` y `count` estaban
 * duplicando la misma mecánica en un único archivo de 1341 líneas. Cada servicio del portal hereda de
 * aquí y recibe la MISMA conexión Sequelize que la fachada, de modo que los tests que construyen la
 * fachada con un doble de `sequelize` siguen funcionando sin cambios.
 */
export abstract class PortalQueryBase {
  constructor(protected readonly sequelize: Sequelize) {}

  protected queryRows<T extends Row>(sql: string, replacements: Row = {}): Promise<T[]> {
    return this.sequelize.query<T>(sql, { replacements, type: QueryTypes.SELECT });
  }

  protected async count(table: string, where = 'TRUE'): Promise<number> {
    const rows = await this.queryRows<{ count: string }>(`SELECT COUNT(*)::text AS count FROM ${table} WHERE ${where};`);
    return intValue(rows[0]?.count, 0);
  }
}
