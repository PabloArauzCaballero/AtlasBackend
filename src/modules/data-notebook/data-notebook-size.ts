/**
 * @file Utilidad pura o acotada reutilizable dentro de su capa.
 * @business Esta pieza abre los datos gobernados al análisis sin dejar que nadie los altere ni los extraiga en claro.
 * @system recorta una página de resultados al techo de bytes, por filas enteras.
 */
import { DATA_NOTEBOOK_LIMITS } from './data-notebook.constants.js';

export type PaginaRecortada = {
  rows: Record<string, unknown>[];
  /** Bytes que ocupan las filas servidas, ya recortadas. */
  bytes: number;
  /** Filas que el techo dejó fuera. Cero cuando la página cupo entera. */
  droppedRows: number;
};

/**
 * Recorta la página al techo de bytes, por filas ENTERAS.
 *
 * Vive en su propio archivo para poder probarse: con los datos que hay hoy en la base ninguna
 * página se acerca al techo —500 filas de la bitácora de auditoría pesan 0,17 MB— así que este
 * camino no se ejercita solo, y un límite que nunca se recorre es un límite del que nadie sabe si
 * funciona hasta el día que hace falta.
 *
 * Se mide fila a fila y se para al pasarse, en vez de serializar todo y cortar la cadena: media
 * fila no es JSON, y quien la recibiera no tendría un dato incompleto sino un error de sintaxis a
 * mitad de la respuesta.
 */
export function recortarPorTamano(
  rows: readonly Record<string, unknown>[],
  techoBytes: number = DATA_NOTEBOOK_LIMITS.maxResponseBytes,
): PaginaRecortada {
  const cabidas: Record<string, unknown>[] = [];
  let bytes = 0;

  for (const fila of rows) {
    const peso = Buffer.byteLength(JSON.stringify(fila), 'utf8');
    // La primera fila entra SIEMPRE, aunque ella sola supere el techo. Devolver cero filas por
    // una fila gorda dejaría el dataset permanentemente vacío sin decir por qué; con una fila
    // delante se puede al menos ver qué columna lo infla.
    if (cabidas.length > 0 && bytes + peso > techoBytes) break;
    cabidas.push(fila);
    bytes += peso;
  }

  return { rows: cabidas, bytes, droppedRows: rows.length - cabidas.length };
}
