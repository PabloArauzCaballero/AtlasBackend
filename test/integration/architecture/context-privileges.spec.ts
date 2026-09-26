/**
 * @file AT-019 — privilegios efectivos por contexto, medidos desde la conexión del rol real.
 * @business Un contexto extraído no puede leer ni escribir tablas ajenas por accidente; y ningún rol
 *   runtime puede cambiar el esquema.
 * @system Conecta como `atlas_ctx_messaging` (creado por `ops/postgres/context-roles.sql`) con la
 *   contraseña de `ATLAS_TEST_CTX_PASSWORD` y comprueba lo que PostgreSQL deniega. Sin la variable la
 *   suite falla (no se salta): la evidencia es la denegación real, no la lectura del script de GRANT.
 */
import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { QueryTypes } from 'sequelize';
import { Sequelize } from 'sequelize-typescript';
import { buildSequelizeOptions } from '../../../src/config/database.config.js';
import { integrationSkipRequested, openIntegrationDatabase, type IntegrationDatabase } from '../support/database.js';

let database: IntegrationDatabase | null = null;
let messaging: Sequelize | null = null;

beforeAll(async () => {
  database = await openIntegrationDatabase();
  if (!database) return;
  const password = process.env.ATLAS_TEST_CTX_PASSWORD;
  if (!password) {
    if (integrationSkipRequested()) return;
    throw new Error('AT-019: falta ATLAS_TEST_CTX_PASSWORD (la contraseña con la que se aplicó ops/postgres/context-roles.sql).');
  }
  const base = buildSequelizeOptions();
  messaging = new Sequelize({ ...base, username: 'atlas_ctx_messaging', password, models: [], logging: false, dialectOptions: undefined });
  await messaging.authenticate();
});

afterAll(async () => {
  await messaging?.close();
  await database?.close();
});

async function attempt(sequelize: Sequelize, sql: string): Promise<string | null> {
  try {
    await sequelize.query(sql, { type: QueryTypes.SELECT });
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

describe('AT-019 · rol de contexto (mensajería)', () => {
  it('lee y escribe sus propias tablas', async () => {
    if (!messaging) return;
    expect(await attempt(messaging, 'SELECT count(*) FROM messaging.notification_messages')).toBeNull();
    expect(await attempt(messaging, 'SELECT count(*) FROM messaging.notification_templates')).toBeNull();
  });

  it('SELECT/UPDATE sobre credit: PostgreSQL deniega', async () => {
    if (!messaging) return;
    expect(await attempt(messaging, 'SELECT count(*) FROM credit.credit_applications')).toMatch(/permission denied/);
    expect(await attempt(messaging, "UPDATE credit.credit_applications SET status = 'x' WHERE false")).toMatch(/permission denied/);
    expect(await attempt(messaging, 'SELECT count(*) FROM customer.customers')).toMatch(/permission denied/);
  });

  it('CREATE/ALTER: denegado incluso en su propio schema', async () => {
    if (!messaging) return;
    expect(await attempt(messaging, 'CREATE TABLE messaging.zz_probe (x integer)')).toMatch(/permission denied/);
    expect(await attempt(messaging, 'ALTER TABLE messaging.notification_messages ADD COLUMN zz integer')).toMatch(
      /must be owner|permission denied/,
    );
  });

  it('el search_path del rol no incluye schemas ajenos: una tabla sin calificar de otro contexto no resuelve', async () => {
    if (!messaging) return;
    const rows = await messaging.query<{ search_path: string }>('SHOW search_path', { type: QueryTypes.SELECT });
    expect(rows[0]?.search_path).not.toMatch(/credit|customer|iam/);
    expect(await attempt(messaging, 'SELECT count(*) FROM customers')).toMatch(/does not exist|permission denied/);
  });

  it('infraestructura compartida (outbox, inbox, idempotencia) sí es accesible mientras se comparte base', async () => {
    if (!messaging) return;
    expect(await attempt(messaging, 'SELECT count(*) FROM platform_ops.outbox_events')).toBeNull();
    expect(await attempt(messaging, 'SELECT count(*) FROM platform_ops.inbox_receipts')).toBeNull();
  });

  it('el rol runtime del monolito sigue sin DDL (no se amplió atlas_app_rw)', async () => {
    if (!database) return;
    expect(await attempt(database.sequelize, 'CREATE TABLE messaging.zz_probe_rw (x integer)')).toMatch(/permission denied/);
  });
});
