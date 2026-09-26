/**
 * Siembra demostrativa del repositorio: llena el portal interno con un conjunto propio y descriptivo.
 *
 *   yarn db:seed:demo               escribe (o actualiza) las filas del bloque reservado 900000+
 *   yarn db:seed:demo --dry-run     imprime qué escribiría, sin tocar la base
 *   yarn db:seed:demo --solo ecosistema,soporte    sólo esos dominios
 *
 * A diferencia de `yarn db:seed:pull`, esto NO trae nada de otra base ni vacía tabla alguna: son
 * upserts por identificador dentro de un rango reservado. Correrla dos veces deja el mismo estado,
 * y lo que haya escrito el runtime sigue donde estaba.
 */
import { Client } from 'pg';
import { env } from '../src/config/env.js';
import { planDeSiembra, sembrarDemo } from '../src/database/seeders/demo/index.js';

function leerOpcion(nombre: string): string | undefined {
  const indice = process.argv.indexOf(nombre);
  return indice >= 0 ? process.argv[indice + 1] : undefined;
}

async function main(): Promise<void> {
  const soloDominios = leerOpcion('--solo')
    ?.split(',')
    .map((valor) => valor.trim())
    .filter(Boolean);

  if (process.argv.includes('--dry-run')) {
    const plan = planDeSiembra();
    for (const linea of plan) console.log(`${linea.dominio.padEnd(16)} ${linea.tabla.padEnd(48)} ${linea.filas}`);
    console.log(`\nTotal: ${plan.reduce((suma, linea) => suma + linea.filas, 0)} filas en ${plan.length} tablas.`);
    return;
  }

  // Identidad de MIGRACIÓN, igual que `db:seed:pull`: el rol de runtime no puede escribir en todas
  // las tablas de catálogo, y un permiso denegado a mitad de la siembra deja media demo puesta.
  const cliente = new Client({
    host: env.DB_HOST,
    port: env.DB_PORT,
    database: env.DB_NAME,
    user: env.DB_MIGRATION_USER ?? env.DB_USER,
    password: env.DB_MIGRATION_PASSWORD ?? env.DB_PASSWORD,
    ssl: env.DB_SSL ? { rejectUnauthorized: env.DB_SSL_REJECT_UNAUTHORIZED } : false,
  });

  await cliente.connect();
  try {
    console.log(`Destino: ${env.DB_HOST}:${env.DB_PORT}/${env.DB_NAME}\n`);
    const resultados = await sembrarDemo(cliente, soloDominios);
    let total = 0;
    for (const resultado of resultados) {
      console.log(`· ${resultado.dominio}`);
      for (const bloque of resultado.bloques) {
        total += bloque.filas;
        console.log(`    ${bloque.tabla.padEnd(48)} ${String(bloque.filas).padStart(5)}${bloque.omitido ? `  (${bloque.omitido})` : ''}`);
      }
    }
    console.log(`\n${total} filas sembradas o actualizadas.`);
  } finally {
    await cliente.end();
  }
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
