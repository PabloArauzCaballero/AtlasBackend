/**
 * Claves cuyo VALOR nunca debe persistirse en claro (audit logs, telemetría, etc.).
 *
 * Dos modos de match, a propósito:
 * - Substring (primer grupo): fragmentos que son sensibles aparezcan donde aparezcan en la clave
 *   (`identifier` cubre el body de POST /auth/login que persistía email/teléfono en claro en
 *   http_action_logs; `fullName`/`firstName`/`lastName` son PII en cualquier clave que los contenga).
 * - Exacto (`^name$`): `name` a secas solo se redacta como clave completa, porque como substring
 *   sobre-redactaría claves técnicas sin PII (jobName, actionName, screenName, …).
 *
 * Nota (deuda preexistente): `lat|lng|gps` se matchean como substring, así que colisionan con claves
 * técnicas que los contienen (p.ej. "temp`lat`eName" → redactada). Es fail-safe (sobre-redacta, no
 * filtra); acotarlos a límites de palabra queda pendiente para no arriesgar under-redacción de
 * claves GPS reales. Ver docs/audit/cierre-correcciones-2026-07-21.md.
 */
const SENSITIVE_KEY_PATTERN =
  /(password|token|secret|authorization|cookie|otp|verificationCode|documentNumber|declaredNumber|encrypted|phone|email|lat|lng|gps|address|reference|rawPayload|evidence|storageKey|payload|identifier|fullName|firstName|lastName)|^name$/i;

/**
 * Escribe una clave en el objeto de salida SIN pasar por los descriptores heredados.
 *
 * Estas dos funciones reciben cuerpos de petición sin confiar en ellos —se usan para redactar antes
 * de registrar— y una clave puede venir de fuera. Con `objeto[clave] = valor`, una clave llamada
 * `__proto__` no crea una propiedad: invoca el SETTER heredado y cambia el prototipo del objeto que
 * se está construyendo, de modo que lo que se escribe después se busca en otro sitio. Es la alerta
 * `js/remote-property-injection` de CodeQL, y aquí es alcanzable desde la red.
 *
 * `defineProperty` crea la propiedad como dato, sin consultar setters: `__proto__` queda como una
 * clave normal del objeto, que es exactamente lo que un registro redactado debe mostrar.
 */
function setOwnProperty(target: Record<string, unknown>, key: string, value: unknown): void {
  Object.defineProperty(target, key, { value, enumerable: true, writable: true, configurable: true });
}

export function stableStringify(value: unknown): string {
  return JSON.stringify(sortValue(value));
}

export function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => sortValue(item));
  }

  if (value && typeof value === 'object' && !(value instanceof Date)) {
    const input = value as Record<string, unknown>;
    return Object.keys(input)
      .sort()
      .reduce<Record<string, unknown>>((accumulator, key) => {
        setOwnProperty(accumulator, key, sortValue(input[key]));
        return accumulator;
      }, {});
  }

  return value;
}

export function redactSensitiveObject<T>(value: T, depth = 0): T | string {
  if (depth > 8) return '[REDACTED_MAX_DEPTH]';
  if (Array.isArray(value)) {
    return value.map((item) => redactSensitiveObject(item, depth + 1)) as T;
  }
  if (value && typeof value === 'object' && !(value instanceof Date)) {
    const input = value as Record<string, unknown>;
    const output: Record<string, unknown> = {};
    for (const [key, nestedValue] of Object.entries(input)) {
      setOwnProperty(output, key, SENSITIVE_KEY_PATTERN.test(key) ? '[REDACTED]' : redactSensitiveObject(nestedValue, depth + 1));
    }
    return output as T;
  }
  return value;
}
