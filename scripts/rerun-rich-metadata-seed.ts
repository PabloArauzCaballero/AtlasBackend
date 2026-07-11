/**
 * Re-corre SOLO el seeder rico de business metadata sin pasar por umzug (que
 * omite seeders ya marcados como ejecutados). Seguro de repetir: cada INSERT
 * del archivo usa ON CONFLICT DO UPDATE. Existe para aplicar el fix de
 * `module = EXCLUDED.module` sin truncar el resto de la base con `reseed`.
 */
import { createSequelizeInstance } from '../src/database/sequelize.js';
import * as seeder from '../src/database/seeders/20260705114000-seed-rich-systems-business-metadata.js';

async function run(): Promise<void> {
  const sequelize = createSequelizeInstance();
  try {
    await seeder.up({ context: sequelize.getQueryInterface() });
    console.log('OK: seeder rico de business metadata re-aplicado.');
  } finally {
    await sequelize.close();
  }
}

run().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
