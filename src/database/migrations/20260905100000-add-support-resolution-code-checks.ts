/**
 * @file Migración reversible: evoluciona el esquema PostgreSQL en orden.
 * @business Impide que una resolución de soporte se guarde con un código que no existe en el catálogo.
 * @system CHECK sobre `resolution_code` y `root_cause_code` derivados de las constantes del código.
 */
import { QueryInterface } from 'sequelize';
import { SUPPORT_RESOLUTION_CODES, SUPPORT_ROOT_CAUSE_CODES } from '../../modules/support/support.constants.js';
import { atlasSchemaFor } from '../domain-schemas.js';

type MigrationContext = { context: QueryInterface };

const RESOLUTIONS = `${atlasSchemaFor('support_resolutions')}.support_resolutions`;

const RESOLUTION_LIST = SUPPORT_RESOLUTION_CODES.map((code) => `'${code}'`).join(', ');
const ROOT_CAUSE_LIST = SUPPORT_ROOT_CAUSE_CODES.map((code) => `'${code}'`).join(', ');

/**
 * La taxonomía estaba sólo en el borde, y el borde no es toda la puerta.
 *
 * ## Qué encontró la auditoría del 2026-09-05
 *
 * `support_case_categories` tiene cuatro CHECK —audiencia, impacto, sensibilidad, urgencia— y
 * `support_resolutions` no tenía ninguno: `resolution_code` y `root_cause_code` son `VARCHAR(60)`
 * validados **únicamente** por el Zod del controlador. Todo lo que no entre por esa ruta —una
 * siembra, un job futuro, una corrección a mano en una incidencia— puede escribir cualquier cadena.
 *
 * ## Por qué importa más aquí que en otros sitios
 *
 * Porque estos dos campos son la razón de ser del expediente cerrado. Un código inventado no rompe
 * ninguna consulta: se cuela en el informe de causas como una categoría más, con su fila y su
 * porcentaje, y nadie distingue «doscientos casos por un defecto de la app» de «doscientos casos
 * por un valor que alguien tecleó mal una vez». La analítica de causas raíz no falla ruidosamente
 * cuando se contamina; da un número distinto y sigue.
 *
 * ## Por qué CHECK y no una tabla de catálogo
 *
 * La categoría de motivo SÍ es una tabla, porque se reorganiza, se versiona y la publica gente de
 * negocio sin desplegar. Estos dos son enumeraciones del dominio: cambian cuando cambia el código
 * que las interpreta, así que su fuente es `support.constants.ts` y añadir un valor debe costar
 * exactamente lo que cuesta aquí — una constante y una migración que reemplaza el CHECK. Precedente
 * de derivar el SQL de la lista canónica en vez de repetirla:
 * `20260821040000-sync-internal-rbac-catalog.ts`.
 *
 * ## Por qué NO se sanean las filas malas
 *
 * La tentación era pasar lo desconocido a `UNKNOWN` y lo raro a `OUT_OF_SCOPE` para que el ALTER no
 * fallara nunca. Sería exactamente lo contrario de lo que este módulo defiende en todo lo demás: la
 * transcripción y la historia del caso no se editan ni se borran, y una resolución es la explicación
 * que se le dio a una persona. Reescribirla desde una migración, en silencio y sin actor, destruiría
 * la evidencia que hace auditable el expediente — y encima ocultaría el bug que metió ese valor.
 *
 * Si hay filas fuera de catálogo, esta migración **falla y dice cuáles**. Que alguien decida qué
 * pasó es más barato que descubrir dentro de un año que un informe de causas venía saneado a ciegas.
 * Comprobado el 2026-09-05 contra el VPS: 0 filas fuera de catálogo en los dos campos.
 */
export async function up({ context: queryInterface }: MigrationContext): Promise<void> {
  const [invalid] = await queryInterface.sequelize.query<{ campo: string; valor: string; filas: string }>(
    `SELECT 'resolution_code' AS campo, resolution_code AS valor, count(*)::text AS filas
       FROM ${RESOLUTIONS} WHERE resolution_code NOT IN (${RESOLUTION_LIST}) GROUP BY 2
      UNION ALL
     SELECT 'root_cause_code', root_cause_code, count(*)::text
       FROM ${RESOLUTIONS} WHERE root_cause_code NOT IN (${ROOT_CAUSE_LIST}) GROUP BY 2;`,
    { type: 'SELECT' as never },
  );

  const rows = (Array.isArray(invalid) ? invalid : invalid ? [invalid] : []) as Array<{
    campo: string;
    valor: string;
    filas: string;
  }>;
  if (rows.length > 0) {
    const detalle = rows.map((row) => `${row.campo}="${row.valor}" (${row.filas} filas)`).join('; ');
    throw new Error(
      `No se puede restringir support_resolutions: hay códigos fuera del catálogo declarado en support.constants.ts — ${detalle}. ` +
        'Corrígelos deliberadamente, con su registro, antes de reintentar; esta migración no reescribe resoluciones.',
    );
  }

  await queryInterface.sequelize.query(`
ALTER TABLE ${RESOLUTIONS}
  DROP CONSTRAINT IF EXISTS ck_support_resolution_code,
  DROP CONSTRAINT IF EXISTS ck_support_root_cause_code;`);

  await queryInterface.sequelize.query(`
ALTER TABLE ${RESOLUTIONS}
  ADD CONSTRAINT ck_support_resolution_code CHECK (resolution_code IN (${RESOLUTION_LIST})),
  ADD CONSTRAINT ck_support_root_cause_code CHECK (root_cause_code IN (${ROOT_CAUSE_LIST}));`);
}

export async function down({ context: queryInterface }: MigrationContext): Promise<void> {
  await queryInterface.sequelize.query(`
ALTER TABLE ${RESOLUTIONS}
  DROP CONSTRAINT IF EXISTS ck_support_resolution_code,
  DROP CONSTRAINT IF EXISTS ck_support_root_cause_code;`);
}
