/**
 * Comprueba que cada objetivo de retención declarado en el código tenga su política PUBLICADA.
 *
 * Antes leía `src/database/seeders/` con expresiones regulares; esos seeders ya no existen y las
 * políticas viven en la RAMA de semillas, así que ahora la comprobación las CONSULTA. Se pierde la
 * propiedad de «correr en CI sin base de datos», pero era una propiedad prestada: verificaba que un
 * literal estuviera escrito en un archivo, no que la política existiera de verdad en ningún sitio.
 *
 * Ejecutar con `yarn check:retention-coverage` (requiere SEED_SOURCE_* configurado).
 */
import { Client } from 'pg';
import { RETENTION_POLICIES_PENDING_DECISION, RETENTION_TARGETS } from '../src/modules/runtime-jobs/retention-targets.js';
import { requireSeedSource } from '../src/database/seed-source.js';
import { handleUnreachableDatabase } from './gate-skip-policy.js';

type SeededPolicy = { code: string; file: string };

async function seededPolicies(): Promise<SeededPolicy[]> {
  const source = requireSeedSource();
  const client = new Client({ connectionString: source.connectionString, ssl: source.ssl });
  await client.connect();
  try {
    const { rows } = await client.query<{ policy_code: string }>('SELECT policy_code FROM privacy.retention_policies ORDER BY policy_code');
    return rows.map((row) => ({ code: row.policy_code, file: source.describe }));
  } finally {
    await client.end();
  }
}

async function main(): Promise<void> {
  let seeded: SeededPolicy[];
  try {
    seeded = await seededPolicies();
  } catch (error) {
    // Mismo criterio que el resto de gates de base (ATLAS-CI-002): sin poder consultar, este gate no
    // comprueba nada y no puede aprobar. Antes la excepción salía cruda —diez líneas de traza de `pg`—
    // y no distinguía «no configuraste el origen» de «el origen no responde».
    handleUnreachableDatabase(error, 'check:retention-coverage');
    return;
  }

  // Cero políticas NO es «todo en orden». Es la respuesta que da también apuntar a la base
  // equivocada, o a una rama de semillas todavía vacía, y con la comprobación anterior salía en
  // verde diciendo «0 en silencio» —que se lee exactamente como el éxito—.
  if (seeded.length === 0) {
    console.error(
      '❌ La fuente de semillas no publica NINGUNA política de retención.\n' +
        '   No es un aprobado: este gate compara lo publicado contra lo ejecutable, y sin nada publicado\n' +
        '   no hay comparación que hacer. Comprueba que SEED_SOURCE_* apunta a la rama correcta.',
    );
    process.exit(1);
  }
  const executable = new Set(Object.keys(RETENTION_TARGETS));
  const declaredPending = new Set(Object.keys(RETENTION_POLICIES_PENDING_DECISION));

  const undecided = seeded.filter((policy) => !executable.has(policy.code) && !declaredPending.has(policy.code));

  // Una entrada de "pendiente de decisión" que ya nadie siembra es ruido que envejece: se avisa para
  // que se borre, del mismo modo que los otros trinquetes del repo reportan sus mejoras.
  const seededCodes = new Set(seeded.map((policy) => policy.code));
  const stalePending = [...declaredPending].filter((code) => !seededCodes.has(code));
  const staleTargets = Object.keys(RETENTION_TARGETS).filter((code) => !seededCodes.has(code));

  if (stalePending.length > 0) {
    console.warn(`ℹ️  Declaradas como pendientes pero ya no publicadas (se pueden borrar): ${stalePending.join(', ')}`);
  }
  if (staleTargets.length > 0) {
    console.warn(`ℹ️  Mapeadas en RETENTION_TARGETS pero no publicadas en la rama de semillas: ${staleTargets.join(', ')}`);
  }

  if (undecided.length > 0) {
    console.error('❌ Políticas de retención sembradas sin destino ejecutable ni decisión declarada:\n');
    for (const policy of undecided) {
      console.error(`   - ${policy.code}  (${policy.file})`);
    }
    console.error(
      '\n   Cada una debe resolverse de una de estas dos formas, en src/modules/runtime-jobs/retention-targets.ts:\n' +
        '     1. Añadirla a RETENTION_TARGETS con su tabla y acción -> el job la ejecutará.\n' +
        '     2. Añadirla a RETENTION_POLICIES_PENDING_DECISION con el motivo por el que aún no puede ejecutarse.\n' +
        '\n   Una política sembrada, activa y sin ejecutar es un control declarado que no se ejerce.',
    );
    process.exit(1);
  }

  console.log(
    `✅ ${seeded.length} políticas de retención sembradas: ${executable.size} ejecutables, ` +
      `${declaredPending.size} con decisión pendiente declarada, 0 en silencio.`,
  );
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
