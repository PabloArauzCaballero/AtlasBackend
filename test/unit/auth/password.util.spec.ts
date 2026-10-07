import { describe, expect, it } from '@jest/globals';
import {
  hashPassword,
  isPasswordStrongEnough,
  verifyPassword,
  verifyPasswordAgainstDummy,
} from '../../../src/common/utils/crypto/password.util.js';

describe('password.util', () => {
  describe('hashPassword / verifyPassword', () => {
    it('produces a hash that verifyPassword accepts for the original password', async () => {
      const hash = await hashPassword('Contrasena-Segura-2026!');
      await expect(verifyPassword(hash, 'Contrasena-Segura-2026!')).resolves.toBe(true);
    });

    it('rejects an incorrect password against a valid hash', async () => {
      const hash = await hashPassword('Contrasena-Segura-2026!');
      await expect(verifyPassword(hash, 'otra-contrasena')).resolves.toBe(false);
    });

    it('never returns the plain text password inside the stored hash', async () => {
      const plain = 'Contrasena-Secreta-XYZ';
      const hash = await hashPassword(plain);
      expect(hash).not.toContain(plain);
    });

    it('does not throw when verifying against a malformed/corrupted hash, returns false instead', async () => {
      await expect(verifyPassword('not-a-real-argon2-hash', 'anything')).resolves.toBe(false);
    });
  });

  describe('verifyPasswordAgainstDummy', () => {
    it('gasta una verificación real de argon2 sin lanzar ni devolver nada', async () => {
      const inicio = Date.now();
      await expect(verifyPasswordAgainstDummy('cualquier-cosa')).resolves.toBeUndefined();
      await expect(verifyPasswordAgainstDummy('cualquier-cosa')).resolves.toBeUndefined();
      expect(Date.now() - inicio).toBeGreaterThan(0);
    });
  });

  describe('isPasswordStrongEnough', () => {
    it('rejects passwords shorter than the minimum length', () => {
      expect(isPasswordStrongEnough('Ab1')).toBe(false);
    });

    it('rejects passwords with only letters', () => {
      expect(isPasswordStrongEnough('SoloLetrasSinNumeros')).toBe(false);
    });

    it('accepts a password with letters and digits above the minimum length', () => {
      expect(isPasswordStrongEnough('AtlasBnpl2026')).toBe(true);
    });
  });
});
