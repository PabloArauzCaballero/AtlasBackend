/**
 * @file Contratos de la siembra demostrativa del repositorio.
 * @business Esta pieza preserva la fuente de verdad y la evidencia histórica que soportan decisiones y cumplimiento.
 * @system define seeders para evolucionar, mapear, sembrar o consultar PostgreSQL de forma controlada.
 */

/**
 * Una referencia a una fila que ya existe, resuelta por su clave NATURAL al escribir.
 *
 * Existe porque la misma siembra tiene que caer bien en dos bases distintas: la de desarrollo, que
 * ya trae colas de soporte y categorías con identificadores bajos, y la de pruebas, que está
 * vacía. Apuntar con un número literal funcionaría sólo en una de las dos; preguntar por el código
 * funciona en las dos y falla ruidosamente si el destino no existe, que es lo que se quiere.
 */
export interface ReferenciaNatural {
  readonly ref: { readonly tabla: string; readonly donde: Record<string, unknown>; readonly columna?: string };
}

export function refA(tabla: string, donde: Record<string, unknown>, columna = '_id'): ReferenciaNatural {
  return { ref: { tabla, donde, columna } };
}

export function esReferencia(valor: unknown): valor is ReferenciaNatural {
  return typeof valor === 'object' && valor !== null && 'ref' in valor;
}

/** Una fila cualquiera: la clave es el nombre REAL de la columna en PostgreSQL. */
export type FilaSembrada = Record<string, unknown>;

/**
 * Un bloque de filas para una tabla.
 *
 * `conflicto` son las columnas del índice único por el que se reconcilia. Por defecto `_id`, que
 * es lo que hace la siembra idempotente: volver a correrla ACTUALIZA la fila del bloque reservado
 * en vez de duplicarla, y nunca borra lo que escribió el runtime.
 */
export interface BloqueSembrado {
  readonly tabla: string;
  readonly filas: readonly FilaSembrada[];
  readonly conflicto?: readonly string[];
  /** Columnas que NO se pisan al reconciliar (p. ej. un contador que el runtime mueve). */
  readonly noPisar?: readonly string[];
  /**
   * `true` cuando una fila cuya referencia natural no existe se OMITE en vez de tumbar la siembra.
   *
   * Existe para las dependencias que este seeder no crea. Los perfiles de carga apuntan a una ruta
   * del catálogo de endpoints, y ese catálogo lo llena un descubrimiento que necesita la API
   * corriendo: en una base recién migrada está vacío. Antes eso mataba la siembra entera —y con
   * ella los doce dominios que venían detrás— por un bloque accesorio. Las filas omitidas se
   * CUENTAN y se dicen en la salida: omitir en silencio sería el mismo verde que miente que esto
   * intenta evitar.
   */
  readonly omitirFilaSiNoResuelve?: boolean;
  /**
   * `true` cuando la tabla es de SÓLO AÑADIR y un `UPDATE` la hace saltar por un disparador.
   *
   * Los mensajes y los eventos de soporte lo son: su integridad se apoya en una cadena de hashes y
   * reescribir una fila la rompería. Aquí el upsert pasa a `DO NOTHING`, que es lo correcto —la
   * fila ya sembrada es válida— y deja la siembra idempotente igual.
   */
  readonly soloAnadir?: boolean;
  /**
   * Predicado del índice único cuando es PARCIAL (`... WHERE _deleted = false`).
   *
   * PostgreSQL no infiere un índice parcial a partir de las columnas solas: sin repetir aquí su
   * condición, el upsert falla con «no unique or exclusion constraint matching the ON CONFLICT
   * specification» aunque el índice exista y sea exactamente ese.
   */
  readonly predicado?: string;
}

/** Un dominio de negocio con sus bloques, en orden de dependencia. */
export interface DominioSembrado {
  readonly nombre: string;
  readonly descripcion: string;
  readonly bloques: readonly BloqueSembrado[];
}

/**
 * Primer identificador del bloque reservado a la siembra del repositorio.
 *
 * Las secuencias de estas tablas van por lo bajo (miles), así que escribir aquí arriba no les
 * quita números ni obliga a tocar `setval`: una fila de runtime posterior sigue recibiendo el
 * siguiente valor de su secuencia sin chocar. Además hace la fila reconocible de un vistazo y
 * permite retirar la demo entera con un `delete ... where _id >= 900000`.
 */
export const PRIMER_ID_DEMO = 900_000;

/** Inquilino de trabajo del portal interno. */
export const TENANT_DEMO = 1;
