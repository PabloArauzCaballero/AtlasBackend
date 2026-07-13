/**
 * Re-corre SOLO el seeder de RBAC interno sin pasar por umzug (que omite
 * seeders ya marcados como ejecutados). Seguro de repetir: permisos usan
 * ON CONFLICT DO UPDATE y role_permissions usa ON CONFLICT DO NOTHING.
 * Existe para aplicar los nuevos permission codes de `notifications.*`
 * agregados a INTERNAL_PERMISSION_SEEDS sin truncar el resto de la base.
 */
import { createSequelizeInstance } from '../src/database/sequelize.js';
import * as seeder from '../src/database/seeders/20260704121000-seed-internal-rbac-and-pablo.js';

async function run(): Promise<void> {
  const sequelize = createSequelizeInstance();
  try {
    await seeder.up({ context: sequelize.getQueryInterface() });
    console.log('OK: seeder de RBAC interno re-aplicado.');
  } finally {
    await sequelize.close();
  }
}

run().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
