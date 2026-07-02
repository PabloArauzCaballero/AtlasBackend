import { randomBytes, createHash } from 'node:crypto';

/**
 * Genera un refresh token opaco (no-JWT) de alta entropía. Solo se persiste su hash SHA-256
 * (`hashRefreshToken`); el valor en claro se entrega al cliente una única vez y nunca se
 * vuelve a poder reconstruir desde la base de datos, igual que un refresh token de OAuth2.
 */
export function generateRefreshToken(): string {
  return randomBytes(48).toString('base64url');
}

export function hashRefreshToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
