import { describe, expect, it, jest } from '@jest/globals';
import type { Client } from 'pg';
import { verifyPassword, isPasswordStrongEnough } from '../../../src/common/utils/crypto/password.util.js';
import {
  applyLocalIdentityOverrides,
  DEFAULT_DEV_ADMIN_EMAIL,
  generateDevAdminPassword,
} from '../../../src/database/seed-local-identities.js';

type Call = [string, unknown[]];

function fakeClient(): { client: Client; calls: Call[] } {
  const calls: Call[] = [];
  const query = jest.fn(async (sql: string, params: unknown[]) => {
    calls.push([sql, params]);
    return { rows: [], rowCount: 1 };
  });
  return { client: { query } as unknown as Client, calls };
}

describe('applyLocalIdentityOverrides (auditoría 2026-10-09)', () => {
  it('sin variables: correo neutro y contraseña aleatoria propia, nunca el hash que trae la semilla', async () => {
    const { client, calls } = fakeClient();
    const result = await applyLocalIdentityOverrides(client, {});

    expect(DEFAULT_DEV_ADMIN_EMAIL).toBe('admin@atlas.local');
    expect(result.adminEmail).toBe('admin@atlas.local');
    expect(calls[0][1]).toEqual(['admin@atlas.local', 1]);

    expect(result.generatedAdminPassword).toBeDefined();
    const hash = calls[1][1][0] as string;
    expect(hash).toMatch(/^\$argon2id\$/u);
    expect(await verifyPassword(hash, result.generatedAdminPassword as string)).toBe(true);
    expect(result.applied).toEqual(['DEV_ADMIN_EMAIL(por defecto)', 'DEV_ADMIN_PASSWORD(aleatoria)']);
    expect(calls).toHaveLength(2);
  });

  it('con variables: usa las de .env, no imprime nada generado y aplica la de comercios', async () => {
    const { client, calls } = fakeClient();
    const result = await applyLocalIdentityOverrides(client, {
      adminEmail: ' yo@ejemplo.com ',
      adminPassword: 'MiClaveLocal-2026',
      partnerPassword: 'ComercioLocal-2026',
    });
    expect(result.generatedAdminPassword).toBeUndefined();
    expect(calls[0][1]).toEqual(['yo@ejemplo.com', 1]);
    expect(await verifyPassword(calls[1][1][0] as string, 'MiClaveLocal-2026')).toBe(true);
    expect(result.applied).toEqual(['DEV_ADMIN_EMAIL', 'DEV_ADMIN_PASSWORD', 'DEV_PARTNER_PASSWORD']);
  });

  it('cadenas vacías cuentan como ausentes', async () => {
    const { client, calls } = fakeClient();
    const result = await applyLocalIdentityOverrides(client, { adminEmail: '', adminPassword: '' });
    expect(calls[0][1]).toEqual(['admin@atlas.local', 1]);
    expect(result.generatedAdminPassword).toBeDefined();
  });

  it('la contraseña generada es larga, distinta cada vez y cumple la regla interna', () => {
    const a = generateDevAdminPassword();
    const b = generateDevAdminPassword();
    expect(a).toHaveLength(24);
    expect(a).not.toBe(b);
    expect(isPasswordStrongEnough(a)).toBe(true);
  });
});
