import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { env } from '../../../config/env.js';

function key(): Buffer {
  const raw = env.NOTIFICATION_TOKEN_ENCRYPTION_KEY ?? env.JWT_ACCESS_TOKEN_SECRET;
  return createHash('sha256').update(raw).digest();
}

export function encryptSecret(plainText: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key(), iv);
  const encrypted = Buffer.concat([cipher.update(plainText, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1:${iv.toString('base64')}:${tag.toString('base64')}:${encrypted.toString('base64')}`;
}

export function decryptSecret(value: string | null): string | null {
  if (!value) return null;
  try {
    const [version, ivB64, tagB64, encryptedB64] = value.split(':');
    if (version !== 'v1' || !ivB64 || !tagB64 || !encryptedB64) return null;
    const decipher = createDecipheriv('aes-256-gcm', key(), Buffer.from(ivB64, 'base64'));
    decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(encryptedB64, 'base64')), decipher.final()]).toString('utf8');
  } catch {
    return null;
  }
}
