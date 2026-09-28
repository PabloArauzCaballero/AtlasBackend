/**
 * Siembra demostrativa del repositorio: llena el portal interno con un conjunto propio y descriptivo.
 *
 *   yarn db:seed:demo               escribe (o actualiza) las filas del bloque reservado 900000+
 *   yarn db:seed:demo --dry-run     imprime qué escribiría, sin tocar la base
 *   yarn db:seed:demo --solo ecosistema,soporte    sólo esos dominios
 *   yarn db:seed:demo --fundamental   sólo la CONFIGURACIÓN (colas, catálogos, políticas, definiciones)
 *                                     y sólo lo que falta: nunca pisa una fila existente
 *
 * La siembra FUNDAMENTAL corre en cada despliegue (job `migrate` de `docker-compose.coolify.yml`):
 * sin ella las pantallas de configuración del portal salen vacías en una base nueva. La COMPLETA
 * —clientes, comercios, préstamos y casos inventados— sigue siendo opt-in (`DEMO_SEED_ENABLED`).
 *
 * A diferencia de `yarn db:seed:pull`, esto NO trae nada de otra base ni vacía tabla alguna: son
 * upserts por identificador dentro de un rango reservado. Correrla dos veces deja el mismo estado,
 * y lo que haya escrito el runtime sigue donde estaba.
 */
import { Client } from 'pg';
import { env } from '../src/config/env.js';
import { planDeSiembra, sembrarDemo } from '../src/database/seeders/demo/index.js';
import type { AlcanceSiembra } from '../src/database/seeders/demo/tipos.js';

function leerOpcion(nombre: string): string | undefined {
  const indice = process.argv.indexOf(nombre);
  return indice >= 0 ? process.argv[indice + 1] : undefined;
}

async function main(): Promise<void> {
  const soloDominios = leerOpcion('--solo')
    ?.split(',')
    .map((valor) => valor.trim())
    .filter(Boolean);

  const alcance: AlcanceSiembra = process.argv.includes('--fundamental') ? 'fundamental' : 'completa';

  if (process.argv.includes('--dry-run')) {
    const plan = planDeSiembra(alcance);
    for (const linea of plan) {
      console.log(
        `${linea.dominio.padEnd(16)} ${linea.tabla.padEnd(48)} ${String(linea.filas).padStart(5)}  ${linea.fundamental ? 'fundamental' : 'demostración'}`,
      );
    }
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
    console.log(`Destino: ${env.DB_HOST}:${env.DB_PORT}/${env.DB_NAME} · siembra ${alcance}\n`);
    const resultados = await sembrarDemo(cliente, soloDominios, alcance);
    let total = 0;
    let nuevas = 0;
    for (const resultado of resultados) {
      console.log(`· ${resultado.dominio}`);
      for (const bloque of resultado.bloques) {
        total += bloque.filas;
        nuevas += bloque.nuevas ?? 0;
        // En la completa un `DO UPDATE` también cuenta como fila afectada: «nuevas» sólo significa algo
        // en la fundamental, donde `DO NOTHING` deja a cero las que ya estaban.
        const detalle =
          alcance === 'fundamental'
            ? `${String(bloque.filas).padStart(5)} · ${String(bloque.nuevas ?? 0).padStart(4)} nuevas`
            : String(bloque.filas).padStart(5);
        console.log(`    ${bloque.tabla.padEnd(48)} ${detalle}${bloque.omitido ? `  (${bloque.omitido})` : ''}`);
      }
    }
    console.log(
      alcance === 'fundamental'
        ? `\nSiembra fundamental: ${total} filas revisadas, ${nuevas} faltaban y se insertaron; las demás ya estaban y no se tocaron.`
        : `\n${total} filas sembradas o actualizadas.`,
    );
  } finally {
    await cliente.end();
  }
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
