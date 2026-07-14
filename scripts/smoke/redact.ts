/**
 * Redacción defensiva para evidencia de smoke tests (ATLAS-P0-SMOKE-001). Los JSON de resultado
 * siguen generándose siempre — solo su contenido se sanea antes de escribirse a disco, porque el
 * archivo puede terminar adjunto a un artifact de CI, compartido para depurar un fallo, etc.
 * Separado de `http.ts` para poder probarlo de forma aislada.
 */
export const REDACTED = '[REDACTED]';

const JWT_FULL_PATTERN = /^eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;
const JWT_EMBEDDED_PATTERN = /eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g;
const BEARER_PATTERN = /Bearer\s+\S+/gi;
const PEM_PATTERN = /-----BEGIN [A-Z ]+-----[\s\S]*?-----END [A-Z ]+-----/g;
const CREDENTIALED_URL_PATTERN = /:\/\/[^/\s:@]+:[^/\s:@]+@/g;

const SENSITIVE_KEYS = new Set([
  'password',
  'passwordhash',
  'accesstoken',
  'refreshtoken',
  'authorization',
  'cookie',
  'set-cookie',
  'apikey',
  'clientsecret',
  'privatekey',
  'tokenhash',
  'otp',
  'mfacode',
  'recoverycode',
]);

function redactWithinString(value: string): string {
  if (JWT_FULL_PATTERN.test(value)) return REDACTED;
  return value
    .replace(JWT_EMBEDDED_PATTERN, REDACTED)
    .replace(BEARER_PATTERN, `Bearer ${REDACTED}`)
    .replace(PEM_PATTERN, REDACTED)
    .replace(CREDENTIALED_URL_PATTERN, `://${REDACTED}@`);
}

/**
 * No muta `value`: siempre retorna una estructura nueva, incluso cuando no hay nada que redactar,
 * para que el llamador nunca dependa (ni accidentalmente) de compartir referencias con el original.
 */
export function redactSensitive(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactSensitive);
  if (typeof value === 'string') return redactWithinString(value);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, val]) => [
        key,
        SENSITIVE_KEYS.has(key.toLowerCase()) ? REDACTED : redactSensitive(val),
      ]),
    );
  }
  return value;
}

const LEAK_SCAN_PATTERNS: RegExp[] = [
  /eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/,
  /Bearer\s+(?!\[REDACTED\])\S+/i,
  /-----BEGIN [A-Z ]+-----/,
  /:\/\/[^/\s:@]+:[^/\s:@]+@/,
];

/** Usado por la prueba de integración: confirma que un JSON ya serializado no dejó ningún patrón sensible sin redactar. */
export function containsUnredactedSecret(serialized: string): boolean {
  return LEAK_SCAN_PATTERNS.some((pattern) => pattern.test(serialized));
}
