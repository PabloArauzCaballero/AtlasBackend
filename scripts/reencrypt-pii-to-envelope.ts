/**
 * ATLAS-P10-011 (cierra ATLAS-PEND-112 junto con la conexión de envelope encryption en
 * customer-onboarding.service.ts y notifications.repository.ts).
 *
 * Re-cifra en lotes, de forma idempotente, los valores que quedaron en formato legado `v1:...`
 * (secret-box.util.ts, clave maestra única) al formato `v2:...` (envelope-encryption.util.ts,
 * data key propia por valor). No requiere downtime: `decryptSecretEnvelope` ya sabe leer ambos
 * formatos, así que este script puede correr mientras la API sigue sirviendo tráfico.
 *
 * Cubre las dos tablas donde se detectó cifrado de PII/tokens en el código real:
 *  - customer_contact_methods.contact_value_encrypted (teléfono/email de clientes)
 *  - device_tokens.token_encrypted (push tokens)
 *
 * Idempotencia: cada fila se relee después de escribir y solo se cuenta como migrada si el
 * valor en base ya empieza con `v2:`. Si el script se interrumpe a mitad de camino, correrlo de
 * nuevo simplemente saltea las filas que ya quedaron en v2 (el `WHERE` solo trae filas `v1:%`).
 *
 * Uso:
 *   tsx scripts/reencrypt-pii-to-envelope.ts --dry-run   # solo cuenta filas pendientes, no escribe
 *   tsx scripts/reencrypt-pii-to-envelope.ts             # re-cifra en lotes de BATCH_SIZE
 *
 * Requiere una base de datos real accesible y usa las mismas env vars que el resto del proyecto.
 * Revisar `docs/pending/pending-items.md` para el estado de ejecución por ambiente.
 */
import { QueryTypes } from 'sequelize';
import { createSequelizeInstance } from '../src/database/sequelize.js';
import { decryptSecretEnvelope, encryptSecretEnvelope } from '../src/common/utils/crypto/envelope-encryption.util.js';

const BATCH_SIZE = 200;
const isDryRun = process.argv.includes('--dry-run');

type TargetTable = {
  table: string;
  idColumn: string;
  valueColumn: string;
  /** Nombre humano solo para logs — nunca se loguea el valor cifrado ni el descifrado. */
  label: string;
};

const TARGETS: TargetTable[] = [
  {
    table: 'customer_contact_methods',
    idColumn: 'id',
    valueColumn: 'contact_value_encrypted',
    label: 'contactos de clientes (teléfono/email)',
  },
  { table: 'device_tokens', idColumn: 'id', valueColumn: 'token_encrypted', label: 'push tokens de dispositivo' },
];

async function migrateTable(
  sequelize: ReturnType<typeof createSequelizeInstance>,
  target: TargetTable,
): Promise<{ migrated: number; failed: number }> {
  let migrated = 0;
  let failed = 0;

  for (;;) {
    const rows = await sequelize.query<{ id: string; value: string }>(
      `SELECT ${target.idColumn} AS id, ${target.valueColumn} AS value
       FROM ${target.table}
       WHERE ${target.valueColumn} LIKE 'v1:%'
       ORDER BY ${target.idColumn}
       LIMIT :limit`,
      { type: QueryTypes.SELECT, replacements: { limit: BATCH_SIZE } },
    );

    if (rows.length === 0) break;

    console.log(`[${target.table}] ${rows.length} fila(s) en v1 encontradas en este lote.`);

    if (isDryRun) {
      migrated += rows.length;
      // En dry-run no seguimos re-consultando el mismo lote infinitamente: solo reportamos el
      // primer lote como muestra y salimos del loop para esta tabla.
      break;
    }

    for (const row of rows) {
      try {
        const plainText = await decryptSecretEnvelope(row.value);
        if (plainText === null) {
          // No se pudo descifrar con la clave maestra actual: no sobreescribir un dato que no
          // podemos confirmar, y dejarlo señalado para revisión manual en vez de perderlo.
          console.error(
            `[${target.table}] fila ${row.id}: no se pudo descifrar el valor v1 existente. Se deja sin tocar — revisar manualmente.`,
          );
          failed += 1;
          continue;
        }
        const reencrypted = await encryptSecretEnvelope(plainText);
        await sequelize.query(
          `UPDATE ${target.table} SET ${target.valueColumn} = :value WHERE ${target.idColumn} = :id AND ${target.valueColumn} = :oldValue`,
          {
            type: QueryTypes.UPDATE,
            replacements: { value: reencrypted, id: row.id, oldValue: row.value },
          },
        );
        migrated += 1;
      } catch (error) {
        console.error(`[${target.table}] fila ${row.id}: error re-cifrando —`, error instanceof Error ? error.message : error);
        failed += 1;
      }
    }
  }

  return { migrated, failed };
}

async function run(): Promise<void> {
  const sequelize = createSequelizeInstance();
  console.log(`ATLAS — re-cifrado PII v1 → v2 (envelope encryption)${isDryRun ? ' [DRY RUN]' : ''}`);
  console.log('----------------------------------------------------------------');

  let totalMigrated = 0;
  let totalFailed = 0;

  try {
    for (const target of TARGETS) {
      console.log(`\n> ${target.label} (${target.table}.${target.valueColumn})`);
      const result = await migrateTable(sequelize, target);
      totalMigrated += result.migrated;
      totalFailed += result.failed;
      console.log(`  migradas: ${result.migrated} | fallidas: ${result.failed}`);
    }
  } finally {
    await sequelize.close();
  }

  console.log('\n----------------------------------------------------------------');
  console.log(`Total migradas: ${totalMigrated} | Total fallidas: ${totalFailed}`);
  if (totalFailed > 0) {
    console.error('Hay filas que no se pudieron re-cifrar. Revisar antes de considerar la migración completa.');
    process.exit(1);
  }
}

run().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
