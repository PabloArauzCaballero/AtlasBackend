/**
 * @file ¿Está viendo la base ENTERA quien va a refrescar el catálogo de sistemas?
 * @business Marcar una columna como obsoleta la saca de la documentación que usan los equipos para
 *   decidir. Hacerlo porque el proceso no pudo verla —y no porque haya dejado de existir— convierte
 *   el catálogo en una fuente que miente con seguridad.
 * @system La introspección lee `information_schema`, cuyas vistas sólo muestran los objetos sobre
 *   los que el rol conectado tiene algún privilegio: con una identidad estrecha la consulta no
 *   falla, simplemente devuelve MENOS. Esto compara lo que ese rol alcanza contra lo que existe de
 *   verdad según `pg_catalog`, que no filtra por privilegios.
 */
import { QueryTypes } from 'sequelize';
import type { Sequelize } from 'sequelize-typescript';

export type CatalogVisibility = { reachable: number; existing: number };

/** Cuántas tablas de esos schemas alcanza el rol conectado, y cuántas hay en realidad. */
export async function readCatalogVisibility(sequelize: Sequelize, schemas: string[]): Promise<CatalogVisibility> {
  const rows = (await sequelize.query(
    `SELECT count(*) FILTER (WHERE has_table_privilege(current_user, c.oid, 'SELECT'))::int AS reachable,
            count(*)::int AS existing
       FROM pg_class c
       JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE c.relkind IN ('r', 'p') AND n.nspname IN (:schemas)`,
    { replacements: { schemas }, type: QueryTypes.SELECT },
  )) as CatalogVisibility[];
  return rows[0] ?? { reachable: 0, existing: 0 };
}

/** Verdadero sólo si el rol alcanza TODAS las tablas que existen (y hay alguna). */
export function seesEverything(visibility: CatalogVisibility): boolean {
  return visibility.existing > 0 && visibility.reachable >= visibility.existing;
}
