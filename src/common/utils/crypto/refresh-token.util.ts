/**
 * @file Utilidad pura o acotada reutilizable dentro de su capa.
 * @business Esta pieza aplica controles coherentes a todos los dominios y reduce fallas repetidas entre equipos.
 * @system provee infraestructura transversal de crypto sin introducir reglas de un dominio específico.
 */
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
