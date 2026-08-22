/**
 * Gate de honestidad de la reportería (`read_api`).
 *
 * Verifica contra un Postgres real que ninguna vista publique un número que engañe. No comprueba
 * que el SQL corra —eso ya lo hace `check:read-api-views`— sino algo que ningún compilador puede
 * ver: que las cifras signifiquen lo que parecen.
 *
 * Las tres reglas salen de defectos MEDIDOS en este repositorio, no de un manual:
 *
 *  1. **Un porcentaje no viaja solo.** Un 100 % sobre tres créditos y un 100 % sobre veinte mil
 *     son idénticos si sólo se manda la tasa. Toda vista con una columna `*_pct` tiene que
 *     publicar además al menos un conteo.
 *  2. **El denominador va protegido.** Una división sin `NULLIF` revienta con cero casos o, peor,
 *     publica un `0` que se lee como «sin mora» cuando lo cierto es «sin datos».
 *  3. **Toda vista se puede acotar por inquilino.** Sin `tenant_id` la consola no la sirve, y una
 *     medida que suma dos organizaciones no significa nada.
 *
 * Existe porque el único sitio del proyecto donde apareció este defecto fue una vista NUEVA: el
 * resto del código ya tenía la disciplina. O sea que el riesgo no está en lo escrito, está en lo
 * que se escriba mañana — y eso es exactamente lo que un gate sirve para cubrir.
 *
 * Si no hay conexión a la base, SE SALTA con aviso y termina en 0: una prueba roja por falta de
 * configuración no informa de ningún defecto.
 *
 * Ejecutar con `yarn check:read-api-honesty`.
 */
import { QueryTypes } from 'sequelize';
import { Sequelize } from 'sequelize-typescript';
import { buildSequelizeOptions } from '../src/config/database.config.js';
import { handleUnreachableDatabase } from './gate-skip-policy.js';

type ColumnaRow = { table_name: string; column_name: string };
type VistaRow = { viewname: string; definition: string };

/**
 * Vistas anteriores a este gate que todavía no publican `tenant_id`.
 *
 * Es un trinquete, no un permiso: la lista NO puede crecer. Estas dos describen la plataforma y no
 * a los clientes de nadie —salud de proveedores y catálogo técnico de endpoints—, así que su falta
 * de inquilino es correcta y no un descuido. Cualquier vista nueva sí tiene que traerlo.
 */
const SIN_INQUILINO_ACEPTADO = new Set(['v_provider_health_latest_v1', 'v_system_endpoint_coverage_v1']);

async function main(): Promise<void> {
  const sequelize = new Sequelize({ ...buildSequelizeOptions(), models: [] });

  try {
    await sequelize.authenticate();
  } catch (error) {
    await sequelize.close().catch(() => undefined);
    handleUnreachableDatabase(error, 'check:read-api-honesty');
    return;
  }

  const fallos: string[] = [];

  try {
    const columnas = (await sequelize.query(
      `SELECT table_name, column_name
         FROM information_schema.columns
        WHERE table_schema = 'read_api'
        ORDER BY table_name, ordinal_position`,
      { type: QueryTypes.SELECT },
    )) as ColumnaRow[];

    const vistas = (await sequelize.query(
      `SELECT viewname, pg_get_viewdef(('read_api.' || viewname)::regclass, true) AS definition
         FROM pg_views WHERE schemaname = 'read_api' ORDER BY viewname`,
      { type: QueryTypes.SELECT },
    )) as VistaRow[];

    const porVista = new Map<string, string[]>();
    for (const columna of columnas) {
      porVista.set(columna.table_name, [...(porVista.get(columna.table_name) ?? []), columna.column_name]);
    }

    for (const vista of vistas) {
      const suyas = porVista.get(vista.viewname) ?? [];
      const porcentajes = suyas.filter((nombre) => /_pct$|_rate$|_ratio$/.test(nombre));
      const conteos = suyas.filter((nombre) => /^(creditos|solicitudes|pagos|total|cantidad)|_count$|^count/.test(nombre));

      // Regla 1: una tasa sin su denominador a la vista es un numero que no se puede discutir.
      if (porcentajes.length > 0 && conteos.length === 0) {
        fallos.push(
          `${vista.viewname}: publica ${porcentajes.join(', ')} y ningun conteo. Una tasa sin su ` +
            `denominador al lado no se puede interpretar: 100% sobre 3 y sobre 20.000 se ven igual.`,
        );
      }

      // Regla 2: toda vista que divide para publicar una tasa protege el denominador.
      if (porcentajes.length > 0 && !/nullif/i.test(vista.definition)) {
        fallos.push(
          `${vista.viewname}: publica ${porcentajes.join(', ')} sin NULLIF en su definicion. Con cero ` +
            `casos falla o publica un 0 que se lee como «sin incidencias» cuando es «sin datos».`,
        );
      }

      // Regla 3: sin inquilino, la consola no puede servirla y la medida mezcla organizaciones.
      const tieneInquilino = suyas.some((nombre) => nombre === 'tenant_id' || nombre === '_tenant_id');
      if (!tieneInquilino && !SIN_INQUILINO_ACEPTADO.has(vista.viewname)) {
        fallos.push(
          `${vista.viewname}: no publica tenant_id. La consola no puede acotarla y la medida sumaria ` +
            `datos de varias organizaciones. Si es una vista de plataforma, declarala en el gate.`,
        );
      }
    }

    if (fallos.length > 0) {
      console.error(`Reporteria deshonesta en read_api (${fallos.length}):\n`);
      console.error(fallos.map((fallo) => `- ${fallo}`).join('\n'));
      process.exitCode = 1;
      return;
    }

    console.log(`check:read-api-honesty OK — ${vistas.length} vistas cumplen las tres reglas.`);
  } finally {
    await sequelize.close().catch(() => undefined);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
