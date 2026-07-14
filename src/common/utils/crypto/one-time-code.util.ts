import { createHash, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';

/**
 * Códigos de un solo uso entregados por correo (reset de contraseña, PIN de login de
 * administradores). Igual que los refresh tokens, solo se persiste el hash SHA-256; el valor en
 * claro viaja una única vez en el correo y nunca puede reconstruirse desde la base de datos.
 */

export function generateNumericCode(length = 6): string {
  let code = '';
  for (let index = 0; index < length; index += 1) {
    code += String(randomInt(0, 10));
  }
  return code;
}

/** Token opaco de desafío para el segundo paso del login con PIN (misma entropía que un refresh token). */
export function generateChallengeToken(): string {
  return randomBytes(48).toString('base64url');
}

export function hashOneTimeCode(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export function verifyOneTimeCode(candidate: string, storedHash: string): boolean {
  const candidateHash = Buffer.from(hashOneTimeCode(candidate), 'hex');
  const expectedHash = Buffer.from(storedHash, 'hex');
  return candidateHash.length === expectedHash.length && timingSafeEqual(candidateHash, expectedHash);
}
