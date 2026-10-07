/**
 * @file Utilidades puras: qué de la respuesta de un paso puede quedar en la evidencia QA.
 * @business Esta pieza impide que una credencial de escritura (la URL firmada de subida) viaje a la evidencia.
 * @system redacta con la utilidad común y además quita URLs firmadas antes de acotar el tamaño.
 */
import { redactSensitiveObject } from '../../../common/utils/privacy/redaction.util.js';

const SIGNED_URL = /[?&](x-amz-signature|signature|sig|token)=/i;

/** La URL firmada de subida es una credencial de escritura: no viaja a la evidencia. */
export function scrubSignedUrls(value: unknown, depth = 0): unknown {
  if (typeof value === 'string') return SIGNED_URL.test(value) ? '[REDACTED]' : value;
  if (depth > 8 || value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map((item) => scrubSignedUrls(item, depth + 1));
  return Object.fromEntries(
    Object.entries(value).map(([key, nested]) => [key, key === 'uploadUrl' ? '[REDACTED]' : scrubSignedUrls(nested, depth + 1)]),
  );
}

export function summarize(body: unknown): unknown {
  const redacted = scrubSignedUrls(redactSensitiveObject(body));
  const text = JSON.stringify(redacted) ?? '';
  return text.length > 4_000 ? { truncated: true, preview: text.slice(0, 4_000) } : redacted;
}
