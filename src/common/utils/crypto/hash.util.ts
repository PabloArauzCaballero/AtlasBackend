import { createHash, randomUUID } from 'node:crypto';

/**
 * Normaliza texto sensible antes de calcular hashes estables.
 * No intenta corregir datos de negocio; solo reduce variaciones triviales.
 */
export function normalizeSensitiveText(value: string): string {
  return value.trim().toLowerCase();
}

/**
 * Calcula SHA-256 hexadecimal para almacenar identificadores sensibles sin guardar el valor claro.
 */
export function sha256Hex(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export function hashSensitiveText(value: string): string {
  return sha256Hex(normalizeSensitiveText(value));
}

export function createStableCode(prefix: string): string {
  const safePrefix =
    prefix
      .trim()
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, '')
      .slice(0, 10) || 'ATLAS';
  return `${safePrefix}-${randomUUID()}`;
}

export function lastCharacters(value: string, count: number): string {
  const normalized = value.trim();
  return normalized.slice(Math.max(0, normalized.length - count));
}
