/**
 * @file Copia de las tablas de Mensajería al destino del piloto, reanudable, con reconciliación (AT-058).
 * @business Herramienta de la ventana de transición: copia lo que Mensajería posee hasta una marca de
 *   agua, se reanuda si se corta y dice si origen y destino coinciden. NUNCA envía mensajes.
 * @system `tsx scripts/messaging/backfill-pilot.ts --target-schema messaging_pilot [--prepare] [--watermark ISO]
 *   [--batch 500] [--reconcile-only]`. Usa la identidad de migración (DDL para preparar el destino). Sale
 *   con código 2 si la reconciliación encuentra diferencias.
 */
import { createMigrationSequelizeInstance } from '../../src/database/sequelize.js';
import {
  copyTable,
  databaseNow,
  MESSAGING_TABLES,
  prepareTarget,
  reconcileTable,
} from '../../src/modules/notifications/infrastructure/pilot/messaging-backfill.js';

function arg(name: string, fallback?: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

async function main(): Promise<void> {
  const targetSchema = arg('target-schema');
  if (!targetSchema) throw new Error('Falta --target-schema.');
  const batchSize = Number(arg('batch', '500'));
  const sequelize = createMigrationSequelizeInstance();
  try {
    const explicit = arg('watermark');
    const watermark = explicit ? new Date(explicit) : await databaseNow(sequelize);
    if (process.argv.includes('--prepare')) await prepareTarget(sequelize, targetSchema);
    let differences = 0;
    for (const table of MESSAGING_TABLES) {
      if (!process.argv.includes('--reconcile-only')) {
        const result = await copyTable({ sequelize, table, targetSchema, watermark, batchSize });
        console.log(`[copy] ${table}: ${result.checkpoint.processed} filas en ${result.checkpoint.batches} lote(s)`);
      }
      const report = await reconcileTable({ sequelize, table, targetSchema, watermark });
      const ok = report.hashMatch && report.missingInTarget.length === 0 && report.extraInTarget.length === 0;
      if (!ok) differences += 1;
      console.log(
        `[reconcile] ${table}: origen ${report.sourceCount} / destino ${report.targetCount} / faltan ${report.missingInTarget.length} / sobran ${report.extraInTarget.length} / hash ${report.hashMatch ? 'igual' : 'DISTINTO'}`,
      );
    }
    if (differences > 0) {
      console.error(`❌ ${differences} tabla(s) con diferencias sin explicar.`);
      process.exitCode = 2;
    }
  } finally {
    await sequelize.close();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
