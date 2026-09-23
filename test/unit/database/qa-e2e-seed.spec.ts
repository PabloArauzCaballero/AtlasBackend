import argon2 from 'argon2';
import type { Client } from 'pg';
import { assertQaSeedTarget, QA_E2E_EMAIL, resetQaIdentity, seedQaIdentity } from '../../../src/database/qa-e2e-seed.js';

const safeTarget = {
  NODE_ENV: 'development',
  ALLOW_E2E_SEED: 'true',
  DB_HOST: 'localhost',
  DB_NAME: 'atlas_e2e_admin',
};

describe('AdminPortal E2E identity seed', () => {
  it.each([
    { ...safeTarget, NODE_ENV: 'production' },
    { ...safeTarget, ALLOW_E2E_SEED: '' },
    { ...safeTarget, DB_HOST: 'postgres.example.com' },
    { ...safeTarget, DB_NAME: 'atlas' },
  ])('rejects unsafe target before opening a database connection: %j', (target) => {
    expect(() => assertQaSeedTarget(target)).toThrow();
  });

  it('accepts only the dedicated local database', () => {
    expect(() => assertQaSeedTarget(safeTarget)).not.toThrow();
    expect(QA_E2E_EMAIL).toMatch(/@atlas-qa\.example\.com$/);
  });

  it('does not query PostgreSQL when an operation receives an unsafe target', async () => {
    const query = jest.fn();
    await expect(
      seedQaIdentity({ query } as unknown as Client, 'run-generated-password-123!', { ...safeTarget, DB_NAME: 'atlas' }),
    ).rejects.toThrow();
    await expect(resetQaIdentity({ query } as unknown as Client, { ...safeTarget, NODE_ENV: 'production' })).rejects.toThrow();
    expect(query).not.toHaveBeenCalled();
  });

  it('stores an Argon2id hash and assigns QA and admin roles in one transaction', async () => {
    const calls: Array<{ sql: string; values?: unknown[] }> = [];
    const query = jest.fn(async (sql: string, values?: unknown[]) => {
      calls.push({ sql, values });
      if (sql.includes('SELECT _id FROM iam.internal_roles')) return { rows: [{ _id: '17' }], rowCount: 1 };
      if (sql.includes('SELECT count(*)::text AS total'))
        return { rows: [{ total: String((values?.[0] as string[]).length) }], rowCount: 1 };
      return { rows: [], rowCount: 1 };
    });
    const password = 'run-generated-password-123!';

    await seedQaIdentity({ query } as unknown as Client, password, safeTarget);

    expect(calls[0]?.sql).toBe('BEGIN');
    expect(calls.at(-1)?.sql).toBe('COMMIT');
    const credential = calls.find((call) => call.sql.includes('INSERT INTO iam.auth_credentials'));
    expect(credential).toBeDefined();
    expect(credential?.sql).toContain('_created_at');
    expect(credential?.values).not.toContain(password);
    expect(await argon2.verify(String(credential?.values?.[0]), password)).toBe(true);
    expect(calls.filter((call) => call.sql.includes('INSERT INTO iam.internal_user_roles'))).toHaveLength(2);
    expect(calls.filter((call) => call.sql.includes('INSERT INTO iam.internal_role_permissions'))).toHaveLength(2);
  });

  it('creates the canonical QA role when a fresh database has no role rows', async () => {
    const calls: string[] = [];
    const query = jest.fn(async (sql: string, values?: unknown[]) => {
      calls.push(sql);
      if (sql.includes('SELECT _id FROM iam.internal_roles')) return { rows: [], rowCount: 0 };
      if (sql.includes('INSERT INTO iam.internal_roles')) return { rows: [{ _id: '17' }], rowCount: 1 };
      if (sql.includes('SELECT count(*)::text AS total'))
        return { rows: [{ total: String((values?.[0] as string[]).length) }], rowCount: 1 };
      return { rows: [], rowCount: 1 };
    });

    await seedQaIdentity({ query } as unknown as Client, 'run-generated-password-123!', safeTarget);

    expect(calls.filter((sql) => sql.includes('INSERT INTO iam.internal_roles'))).toHaveLength(2);
    expect(calls.at(-1)).toBe('COMMIT');
  });

  it('resets only the synthetic QA actor within a transaction', async () => {
    const calls: Array<{ sql: string; values?: unknown[] }> = [];
    const query = jest.fn(async (sql: string, values?: unknown[]) => {
      calls.push({ sql, values });
      return { rows: [], rowCount: 1 };
    });

    await resetQaIdentity({ query } as unknown as Client, safeTarget);

    expect(calls[0]?.sql).toBe('BEGIN');
    expect(calls.at(-1)?.sql).toBe('COMMIT');
    expect(calls.some((call) => call.sql.includes('DELETE FROM iam.auth_credentials'))).toBe(true);
    expect(calls.some((call) => call.sql.includes('UPDATE iam.internal_users'))).toBe(true);
  });
});
