/**
 * @file La conversión de huellas de teléfono a HMAC contra PostgreSQL real: escalar, filtrada y array, idempotente y rotable (APP-21).
 * @business Si la conversión deja una sola fila atrás, ese cliente no entra con su teléfono y su agenda deja de cruzar: sin error, a cero.
 * @system tablas de usar y tirar en `platform_ops`, DENTRO DE UNA TRANSACCIÓN QUE SIEMPRE SE DESHACE sobre un pool de una conexión
 *   (el mismo patrón que `constraint-guard.spec.ts`); ejercita `upgradeAllPhoneHashes` y `countProtectedPhoneHashes`.
 */
import { createHash } from 'node:crypto';
import { afterAll, afterEach, beforeAll, describe, expect, it } from '@jest/globals';
import { QueryTypes } from 'sequelize';
import { Sequelize } from 'sequelize-typescript';
import { env } from '../../../src/config/env.js';
import { buildMigrationSequelizeOptions } from '../../../src/config/database.config.js';
import { phoneLookupHashFromPlain } from '../../../src/common/utils/crypto/phone-hash.util.js';
import {
  countProtectedPhoneHashes,
  upgradeAllPhoneHashes,
  type PhoneHashColumn,
  type RunQuery,
} from '../../../src/database/migration-support/phone-hash-columns.js';
import { integrationSkipRequested, runToken } from '../support/database.js';
import { requireIsolatedDatabase } from '../../support/isolated-database.guard.js';

const token = runToken();
const escalar = `it_phone_escalar_${token}`;
const agenda = `it_phone_agenda_${token}`;
const mutable = env as { PHONE_HASH_HMAC_KEYS?: string };
const original = mutable.PHONE_HASH_HMAC_KEYS;
const K1 = '1:clave-uno-de-integracion-de-mas-de-32-caracteres';
const K2 = `${K1},2:clave-dos-de-integracion-de-mas-de-32-caracteres`;
const sha = (telefono: string) => createHash('sha256').update(telefono.trim().toLowerCase()).digest('hex');

const COLUMNAS: PhoneHashColumn[] = [
  { schema: 'platform_ops', table: escalar, column: 'valor', where: "tipo = 'phone'" },
  { schema: 'platform_ops', table: agenda, column: 'hashes', array: true },
];

let db: Sequelize | null = null;
let skipped = false;

const run: RunQuery = async (sql, params) => {
  const select = /^\s*SELECT/iu.test(sql);
  const result = await db!.query(sql, { bind: params, type: select ? QueryTypes.SELECT : QueryTypes.UPDATE });
  return select ? (result as unknown as Array<Record<string, unknown>>) : [];
};

async function filas<T>(sql: string): Promise<T[]> {
  return (await db!.query(sql, { type: QueryTypes.SELECT })) as T[];
}

beforeAll(async () => {
  requireIsolatedDatabase();
  const { retryAttempts, retryDelay, ...opciones } = buildMigrationSequelizeOptions();
  void retryAttempts;
  void retryDelay;
  db = new Sequelize({ ...opciones, models: [], logging: false, pool: { max: 1, min: 1, idle: 10_000, acquire: 30_000 } });
  try {
    await db.authenticate();
  } catch (error) {
    await db.close().catch(() => undefined);
    db = null;
    if (integrationSkipRequested()) {
      skipped = true;
      return;
    }
    throw error;
  }
  await db.query('BEGIN');
  await db.query(`CREATE TABLE platform_ops.${escalar} ("_id" bigint PRIMARY KEY, tipo text NOT NULL, valor varchar(128))`);
  await db.query(`CREATE TABLE platform_ops.${agenda} ("_id" bigint PRIMARY KEY, hashes text[] NOT NULL DEFAULT '{}')`);
  await db.query(
    `INSERT INTO platform_ops.${escalar} VALUES
       (1, 'phone', '${sha('+59171111111')}'), (2, 'phone', '${sha('+59172222222')}'),
       (3, 'email', '${sha('ana@example.com')}'), (4, 'phone', NULL)`,
  );
  await db.query(
    `INSERT INTO platform_ops.${agenda} VALUES
       (1, ARRAY['${sha('+59171111111')}', '${sha('+59173333333')}']), (2, '{}')`,
  );
});

afterEach(() => {
  mutable.PHONE_HASH_HMAC_KEYS = original;
});

afterAll(async () => {
  await db?.query('ROLLBACK').catch(() => undefined);
  await db?.close().catch(() => undefined);
});

describe('conversión de huellas de teléfono', () => {
  it('sin nada que convertir no necesita la clave', async () => {
    if (skipped) return;
    mutable.PHONE_HASH_HMAC_KEYS = undefined;
    const vacias: PhoneHashColumn[] = [{ schema: 'platform_ops', table: escalar, column: 'valor', where: "tipo = 'nada'" }];
    await expect(upgradeAllPhoneHashes(run, undefined, vacias)).resolves.toEqual({ [`${escalar}.valor`]: 0 });
  });

  it('con filas pendientes y sin clave falla antes de escribir', async () => {
    if (skipped) return;
    mutable.PHONE_HASH_HMAC_KEYS = undefined;
    await expect(upgradeAllPhoneHashes(run, undefined, COLUMNAS)).rejects.toThrow(/PHONE_HASH_HMAC_KEYS/u);
    expect(await countProtectedPhoneHashes(run, COLUMNAS)).toBe(0);
  });

  it('convierte teléfonos (escalares y arrays), deja los correos y es idempotente', async () => {
    if (skipped) return;
    mutable.PHONE_HASH_HMAC_KEYS = K1;
    const primera = await upgradeAllPhoneHashes(run, undefined, COLUMNAS);
    expect(primera).toEqual({ [`${escalar}.valor`]: 2, [`${agenda}.hashes`]: 1 });

    const escalares = await filas<{ _id: string; valor: string | null }>(`SELECT "_id", valor FROM platform_ops.${escalar} ORDER BY "_id"`);
    expect(escalares.map((f) => f.valor)).toEqual([
      phoneLookupHashFromPlain('+59171111111'),
      phoneLookupHashFromPlain('+59172222222'),
      sha('ana@example.com'),
      null,
    ]);
    const arrays = await filas<{ hashes: string[] }>(`SELECT hashes FROM platform_ops.${agenda} ORDER BY "_id"`);
    expect(arrays[0]?.hashes).toEqual([phoneLookupHashFromPlain('+59171111111'), phoneLookupHashFromPlain('+59173333333')].sort());
    expect(arrays[1]?.hashes).toEqual([]);

    // El cruce sigue dando lo mismo: el teléfono del cliente 1 está en la agenda, el del 2 no.
    const cruce = await filas<{ n: number }>(
      `SELECT count(*)::int AS n FROM platform_ops.${escalar} e JOIN platform_ops.${agenda} a ON e.valor = ANY(a.hashes)`,
    );
    expect(cruce[0]?.n).toBe(1);

    expect(await upgradeAllPhoneHashes(run, undefined, COLUMNAS)).toEqual({ [`${escalar}.valor`]: 0, [`${agenda}.hashes`]: 0 });
    expect(await countProtectedPhoneHashes(run, COLUMNAS)).toBe(3);
  });

  it('rotar a la versión 2 envuelve lo guardado y coincide con lo que calcula el código', async () => {
    if (skipped) return;
    mutable.PHONE_HASH_HMAC_KEYS = K2;
    const rotadas = await upgradeAllPhoneHashes(run, undefined, COLUMNAS);
    expect(rotadas).toEqual({ [`${escalar}.valor`]: 2, [`${agenda}.hashes`]: 1 });
    const escalares = await filas<{ valor: string }>(`SELECT valor FROM platform_ops.${escalar} WHERE "_id" = 1`);
    expect(escalares[0]?.valor).toBe(phoneLookupHashFromPlain('+59171111111'));
    expect(escalares[0]?.valor.startsWith('ph2:')).toBe(true);
  });
});
