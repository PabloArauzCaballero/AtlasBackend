/**
 * @file Artefacto de soporte específico de esta carpeta.
 * @business Esta pieza ofrece a operaciones una vista gobernada del negocio sin acceso directo a tablas sensibles.
 * @system compone consultas read-only, reportes, glosario, linaje y búsqueda para el portal administrativo.
 */
import { QueryTypes } from 'sequelize';
import { Sequelize } from 'sequelize-typescript';
import { intValue, Row } from './portal-format.util.js';
import { PortalScope, scopeReplacements, tenantPredicate } from './portal-scope.util.js';

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

  /**
   * Conteo sobre una tabla de CATÁLOGO DE PLATAFORMA (sin `_tenant_id`): endpoints, entidades de
   * datos, reglas de calidad. `table` y `where` son literales escritos en el propio código del
   * portal, nunca entrada del usuario — para valores dinámicos existen los `replacements`.
   */
  protected async count(table: string, where = 'TRUE'): Promise<number> {
    const rows = await this.queryRows<{ count: string }>(`SELECT COUNT(*)::text AS count FROM ${table} WHERE ${where};`);
    return intValue(rows[0]?.count, 0);
  }

  /**
   * Conteo sobre una tabla CON `_tenant_id`, acotado al alcance del actor (ATLAS-SEC-009).
   *
   * Existe como método aparte de `count` a propósito: obliga a decidir, en cada llamada, si la
   * tabla es catálogo compartido o dato de un tenant. Un único helper "que a veces filtra" es
   * justamente cómo se coló la fuga original.
   */
  protected async countInScope(scope: PortalScope, table: string, alias: string, where = 'TRUE'): Promise<number> {
    const rows = await this.queryRows<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM ${table} ${alias} WHERE ${tenantPredicate(scope, alias)} AND (${where});`,
      scopeReplacements(scope),
    );
    return intValue(rows[0]?.count, 0);
  }
}
