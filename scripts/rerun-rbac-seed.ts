/**
 * Re-corre el RBAC interno + el usuario admin de desarrollo sin pasar por umzug (que omite
 * seeders ya marcados como ejecutados). Seguro de repetir: permisos usan ON CONFLICT DO UPDATE y
 * role_permissions usa ON CONFLICT DO NOTHING. Existe para aplicar nuevos permission codes (p. ej.
 * `notifications.*`) sin truncar el resto de la base.
 *
 * El antiguo seeder combinado `20260704121000-seed-internal-rbac-and-pablo` se dividió en un baseline
 * productivo de roles/permisos y el usuario Pablo de desarrollo; este script corre ambos en orden.
 * El seeder de Pablo lanza si `NODE_ENV=production`, por lo que esta utilidad es solo para dev/staging.
 */
import { createSequelizeInstance } from '../src/database/sequelize.js';
import * as rbacSeeder from '../src/database/seeders/production/20260704121000-seed-internal-rbac.js';
import * as pabloSeeder from '../src/database/seeders/development/20260704121500-seed-pablo-admin-user.js';

async function run(): Promise<void> {
  const sequelize = createSequelizeInstance();
  try {
    await rbacSeeder.up({ context: sequelize.getQueryInterface() });
    await pabloSeeder.up({ context: sequelize.getQueryInterface() });
    console.log('OK: RBAC interno + usuario admin de desarrollo re-aplicados.');
  } finally {
    await sequelize.close();
  }
}

run().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
