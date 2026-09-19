/**
 * @file Orquesta la siembra demostrativa: qué dominios entran y en qué orden.
 * @business Esta pieza preserva la fuente de verdad y la evidencia histórica que soportan decisiones y cumplimiento.
 * @system define seeders para evolucionar, mapear, sembrar o consultar PostgreSQL de forma controlada.
 */
import type { Client } from 'pg';
import { ACTIVIDAD } from './actividad.seed-data.js';
import { CARTERA } from './cartera.seed-data.js';
import { CASOS } from './casos.seed-data.js';
import { CLIENTES } from './clientes.seed-data.js';
import { COMERCIOS_DEMO } from './comercios.seed-data.js';
import { DEFINICIONES } from './definiciones.seed-data.js';
import { ECOSISTEMA } from './ecosistema.seed-data.js';
import { EQUIPO } from './equipo.seed-data.js';
import { GOBIERNO } from './gobierno.seed-data.js';
import { REFERENCIA } from './referencia.seed-data.js';
import { OPERACIONES } from './operaciones.seed-data.js';
import { MENSAJERIA } from './mensajeria.seed-data.js';
import { SOPORTE } from './soporte.seed-data.js';
import { escribirDominio, type ResultadoBloque } from './escritor.js';
import type { DominioSembrado } from './tipos.js';

/**
 * El orden importa: un dominio sólo puede depender de los que tiene delante.
 *
 * No hay resolución automática de dependencias a propósito. Las claves foráneas de la siembra son
 * identificadores literales del bloque reservado, así que el orden es la única garantía que hace
 * falta y se lee de un vistazo — un grafo que se ordena solo esconde justo lo que conviene ver.
 */
export const DOMINIOS: readonly DominioSembrado[] = [
  REFERENCIA,
  // `equipo` va ANTES que `definiciones`: los artefactos de decisión registran quién los cambió, y
  // ese usuario interno lo crea `equipo`. Con el orden al revés el despliegue murió con «violates
  // foreign key constraint decision_artifact_bindings_changed_by_internal_user_id_fkey» — en local
  // no se veía porque la corrida anterior ya había dejado el usuario puesto.
  EQUIPO,
  ECOSISTEMA,
  DEFINICIONES,
  CLIENTES,
  COMERCIOS_DEMO,
  CARTERA,
  SOPORTE,
  GOBIERNO,
  CASOS,
  MENSAJERIA,
  OPERACIONES,
  ACTIVIDAD,
];

export interface ResultadoSiembra {
  readonly dominio: string;
  readonly bloques: readonly ResultadoBloque[];
}

export async function sembrarDemo(cliente: Client, soloDominios?: readonly string[]): Promise<ResultadoSiembra[]> {
  const elegidos = soloDominios?.length ? DOMINIOS.filter((d) => soloDominios.includes(d.nombre)) : DOMINIOS;
  if (soloDominios?.length) {
    const desconocidos = soloDominios.filter((nombre) => !DOMINIOS.some((d) => d.nombre === nombre));
    if (desconocidos.length > 0) {
      throw new Error(`Dominios desconocidos: ${desconocidos.join(', ')}. Disponibles: ${DOMINIOS.map((d) => d.nombre).join(', ')}`);
    }
  }

  const resultados: ResultadoSiembra[] = [];
  for (const dominio of elegidos) {
    resultados.push({ dominio: dominio.nombre, bloques: await escribirDominio(cliente, dominio) });
  }
  return resultados;
}

/** Cuántas filas declara cada dominio, sin tocar la base. Es lo que imprime `--dry-run`. */
export function planDeSiembra(): { dominio: string; tabla: string; filas: number }[] {
  return DOMINIOS.flatMap((dominio) =>
    dominio.bloques.map((bloque) => ({ dominio: dominio.nombre, tabla: bloque.tabla, filas: bloque.filas.length })),
  );
}
