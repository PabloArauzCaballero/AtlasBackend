/** Alta y reset explícitos de la identidad QA sintética de AdminPortal. */
import { Client } from 'pg';
import { assertQaSeedTarget, resetQaIdentity, seedQaIdentity, seedQaSchemaCatalog } from '../src/database/qa-e2e-seed.js';

async function main(): Promise<void> {
  const command = process.argv[2];
  if (command !== 'up' && command !== 'down') throw new Error('Uso: seed-admin-e2e.ts up|down');

  const target = {
    NODE_ENV: process.env.NODE_ENV,
    ALLOW_E2E_SEED: process.env.ALLOW_E2E_SEED,
    DB_HOST: process.env.DB_HOST,
    DB_NAME: process.env.DB_NAME,
  };
  assertQaSeedTarget(target);
  const password = process.env.TEST_PASSWORD;
  if (command === 'up' && !password) throw new Error('Falta TEST_PASSWORD generado por el runner.');

  const client = new Client({
    host: target.DB_HOST,
    port: Number(process.env.DB_PORT ?? 5432),
    database: target.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
  });
  await client.connect();
  try {
    if (command === 'up') {
      await seedQaIdentity(client, password as string, target);
      await seedQaSchemaCatalog(client, target);
    } else await resetQaIdentity(client, target);
    console.log(`Identidad QA E2E ${command === 'up' ? 'preparada' : 'restaurada'} en la base efímera.`);
  } finally {
    await client.end();
  }
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
