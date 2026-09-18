/**
 * @file Escribe los bloques de la siembra demostrativa con upserts idempotentes.
 * @business Esta pieza preserva la fuente de verdad y la evidencia histórica que soportan decisiones y cumplimiento.
 * @system define seeders para evolucionar, mapear, sembrar o consultar PostgreSQL de forma controlada.
 */
import type { Client } from 'pg';
import { esReferencia, type BloqueSembrado, type DominioSembrado, type FilaSembrada, type ReferenciaNatural } from './tipos.js';

export interface ResultadoBloque {
  readonly tabla: string;
  readonly filas: number;
  readonly omitido?: string;
  /** Filas que no entraron porque su referencia natural no existe en esta base. */
  readonly omitidas?: number;
}

/** Una referencia natural que no existe en esta base. Se distingue para poder omitir la fila. */
export class ReferenciaNoResuelta extends Error {}

function columnasDe(filas: readonly FilaSembrada[]): string[] {
  const vistas = new Set<string>();
  for (const fila of filas) for (const clave of Object.keys(fila)) vistas.add(clave);
  return [...vistas];
}

function entrecomilla(identificador: string): string {
  return identificador
    .split('.')
    .map((parte) => `"${parte.replace(/"/g, '""')}"`)
    .join('.');
}

/** Un valor `object` va a PostgreSQL como JSON; `pg` no sabe serializar un objeto plano a jsonb. */
function aParametro(valor: unknown): unknown {
  if (valor === undefined) return null;
  if (valor === null) return null;
  if (valor instanceof Date) return valor;
  if (typeof valor === 'object') return JSON.stringify(valor);
  return valor;
}

export function sentenciaDe(bloque: BloqueSembrado): { sql: string; columnas: string[] } {
  const columnas = columnasDe(bloque.filas);
  const conflicto = bloque.conflicto ?? ['_id'];
  // `_id` nunca se actualiza. Cuando el bloque reconcilia por clave NATURAL —una cola de soporte
  // por su código, por ejemplo— la fila que ya existe en desarrollo tiene su propio identificador,
  // y pisarlo con el del bloque reservado movería la clave primaria por debajo de todas las claves
  // foráneas que apuntan a ella. Por eso las referencias entre bloques se resuelven por código
  // (`refA`) y no por número.
  const noPisar = new Set(['_id', ...(bloque.noPisar ?? []), ...conflicto]);
  const actualizables = columnas.filter((columna) => !noPisar.has(columna));
  const asignaciones = actualizables.map((columna) => `${entrecomilla(columna)} = EXCLUDED.${entrecomilla(columna)}`);

  const valores = `(${columnas.map((_, indice) => `$${indice + 1}`).join(', ')})`;
  const destino = conflicto.map(entrecomilla).join(', ');
  const predicado = bloque.predicado ? ` WHERE ${bloque.predicado}` : '';
  // Sin columnas actualizables (una tabla que es sólo su clave) el upsert sigue siendo válido:
  // `DO NOTHING` deja la fila existente intacta, que es justo lo idempotente.
  const resolucion = asignaciones.length > 0 && !bloque.soloAnadir ? `DO UPDATE SET ${asignaciones.join(', ')}` : 'DO NOTHING';

  return {
    sql: `INSERT INTO ${entrecomilla(bloque.tabla)} (${columnas.map(entrecomilla).join(', ')}) VALUES ${valores} ON CONFLICT (${destino})${predicado} ${resolucion}`,
    columnas,
  };
}

/**
 * Escribe un bloque fila por fila.
 *
 * Fila por fila y no en un único `VALUES` gigante a propósito: cuando una fila viola un CHECK o una
 * clave foránea, el error nombra la fila que lo hizo en vez de tumbar el lote entero sin decir
 * cuál. La siembra se corre a mano o en el arranque, no en un camino caliente: la claridad vale
 * más que el viaje de red ahorrado.
 */
async function resolverReferencia(cliente: Client, referencia: ReferenciaNatural, cache: Map<string, unknown>): Promise<unknown> {
  const { tabla, donde, columna = '_id' } = referencia.ref;

  // El `donde` puede a su vez llevar una referencia —el paso de una suite se busca por (suite, orden)
  // y la suite, por su código—, así que se resuelve de dentro hacia fuera antes de consultar.
  const condicionesResueltas: Record<string, unknown> = {};
  for (const [nombre, valor] of Object.entries(donde)) {
    condicionesResueltas[nombre] = esReferencia(valor) ? await resolverReferencia(cliente, valor, cache) : valor;
  }

  const clave = `${tabla}|${columna}|${JSON.stringify(condicionesResueltas)}`;
  if (cache.has(clave)) return cache.get(clave);

  const condiciones = Object.keys(condicionesResueltas).map((nombre, indice) => `${entrecomilla(nombre)} = $${indice + 1}`);
  const { rows } = await cliente.query(
    `SELECT ${entrecomilla(columna)} AS valor FROM ${entrecomilla(tabla)} WHERE ${condiciones.join(' AND ')} LIMIT 1`,
    Object.values(condicionesResueltas),
  );
  if (rows.length === 0) {
    throw new ReferenciaNoResuelta(`no existe ${tabla} con ${JSON.stringify(condicionesResueltas)}; siembra antes el dominio que la crea`);
  }
  const valor = (rows[0] as Record<string, unknown>).valor;
  cache.set(clave, valor);
  return valor;
}

export async function escribirBloque(
  cliente: Client,
  bloque: BloqueSembrado,
  cache = new Map<string, unknown>(),
): Promise<ResultadoBloque> {
  if (bloque.filas.length === 0) return { tabla: bloque.tabla, filas: 0, omitido: 'sin filas' };
  const { sql, columnas } = sentenciaDe(bloque);

  let escritas = 0;
  let omitidas = 0;
  let primerMotivo = '';

  for (const [indice, fila] of bloque.filas.entries()) {
    const parametros: unknown[] = [];
    try {
      for (const columna of columnas) {
        const valor = fila[columna];
        parametros.push(aParametro(esReferencia(valor) ? await resolverReferencia(cliente, valor, cache) : valor));
      }
    } catch (error) {
      if (error instanceof ReferenciaNoResuelta && bloque.omitirFilaSiNoResuelve) {
        omitidas += 1;
        primerMotivo ||= error.message;
        continue;
      }
      const detalle = error instanceof Error ? error.message : String(error);
      throw new Error(`${bloque.tabla}: la fila ${indice + 1} de ${bloque.filas.length} no entró (${detalle})`);
    }
    try {
      await cliente.query(sql, parametros);
      escritas += 1;
    } catch (error) {
      const detalle = error instanceof Error ? error.message : String(error);
      throw new Error(`${bloque.tabla}: la fila ${indice + 1} de ${bloque.filas.length} no entró (${detalle})`);
    }
  }
  return {
    tabla: bloque.tabla,
    filas: escritas,
    ...(omitidas > 0 ? { omitidas, omitido: `${omitidas} omitidas: ${primerMotivo}` } : {}),
  };
}

export async function escribirDominio(cliente: Client, dominio: DominioSembrado): Promise<ResultadoBloque[]> {
  const resultados: ResultadoBloque[] = [];
  // Una caché por dominio: dentro de una misma corrida los códigos naturales no cambian, y sin
  // ella una tabla de 400 filas que apunta a la misma cola hace 400 SELECT idénticos.
  const cache = new Map<string, unknown>();
  for (const bloque of dominio.bloques) resultados.push(await escribirBloque(cliente, bloque, cache));
  return resultados;
}
