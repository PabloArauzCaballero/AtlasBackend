/**
 * Redacción de secretos/PII en TEXTO LIBRE (líneas de log, chunks de Archivo.log).
 *
 * Complementa a `redactSensitiveObject` (`redaction.util.ts`), que solo cubre objetos
 * estructurados: aquí el input es una cadena ya formateada, así que se enmascaran valores
 * que siguen a claves sensibles (`password=...`, `token: "..."`, `"secret": '...'`),
 * credenciales `Bearer ...` y emails con una regex conservadora.
 *
 * La lista de claves replica el espíritu de `SENSITIVE_KEY_PATTERN` de `redaction.util.ts`
 * (que no se exporta), acotada a las claves que aparecen como `clave=valor`/`clave: valor`
 * en texto: claves demasiado genéricas para texto libre (`address`, `reference`, `payload`)
 * se omiten a propósito porque en una línea de log enmascararían prosa normal.
 */
const SENSITIVE_TEXT_KEYS = [
  'password',
  'passwd',
  'pwd',
  'token',
  'secret',
  'authorization',
  'cookie',
  'otp',
  'verificationCode',
  'verification_code',
  'documentNumber',
  'document_number',
  'declaredNumber',
  'declared_number',
  'apiKey',
  'api_key',
].join('|');

// `clave=valor`, `clave: valor`, `"clave": "valor"` — admite prefijo/sufijo de la clave
// (accessToken, REFRESH_TOKEN, clientSecret) igual que el matching por substring de
// `SENSITIVE_KEY_PATTERN`. El valor es un string entrecomillado o un token sin espacios.
const KEY_VALUE_PATTERN = new RegExp(
  `(["']?[\\w.-]*(?:${SENSITIVE_TEXT_KEYS})[\\w.-]*["']?\\s*[:=]\\s*)("[^"]*"|'[^']*'|[^\\s,;)}\\]]+)`,
  'gi',
);

const BEARER_PATTERN = /\b(Bearer\s+)[A-Za-z0-9\-._~+/]+=*/gi;

// Regex de email conservadora a propósito: `algo@dominio.tld` con TLD alfabético de 2+.
const EMAIL_PATTERN = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;

/**
 * Enmascara secretos/PII en una línea de texto libre. Pensada para el hot path del logger:
 * tres `String.replace` con regex precompiladas, sin parseo ni asignaciones intermedias.
 */
export function redactSensitiveText(line: string): string {
  return line.replace(KEY_VALUE_PATTERN, '$1[REDACTED]').replace(BEARER_PATTERN, '$1[REDACTED]').replace(EMAIL_PATTERN, '[REDACTED_EMAIL]');
}
