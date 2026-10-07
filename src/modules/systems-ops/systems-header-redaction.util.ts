/**
 * @file Artefacto de soporte específico de esta carpeta.
 * @business Las llaves que QA pone en las cabeceras de una suite no salen en claro por la API ni se guardan en las corridas.
 * @system redacta cabeceras por NOMBRE; lo usan el mapper de pasos y el runner de suites.
 *
 * El redactor general (`redactSensitiveObject`) no trata `key` como sensible —sobre-redactaría claves
 * técnicas en todo el backend—, así que `x-api-key` o `x-platform-catalog-key` pasaban en claro. En
 * una CABECERA, en cambio, `key` casi siempre es una credencial: es el mismo criterio que ya aplica
 * `SystemsStressRunService` al encolar una corrida de estrés.
 */
export const REDACTED_HEADER_VALUE = '[REDACTED]';

const SECRET_HEADER_PATTERN = /authorization|token|cookie|secret|key/i;

/** `{{config.apiKey}}` o `Bearer {{context.token}}`: una referencia a un valor, no el valor. */
const TEMPLATE_REFERENCE_PATTERN = /^\s*(?:[A-Za-z]+\s+)?\{\{[^{}]+}}\s*$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Devuelve una copia con el valor de las cabeceras sensibles sustituido por `[REDACTED]`.
 *
 * `keepTemplates` conserva las referencias de plantilla: en la DEFINICIÓN de un paso, saber que la
 * llave sale de `{{config.apiKey}}` es lo que permite editarlo, y no revela ningún secreto. En una
 * corrida las plantillas ya están resueltas, así que ahí no se conserva nada.
 */
export function redactSecretHeaders(headers: unknown, options: { keepTemplates?: boolean } = {}): Record<string, unknown> {
  const redacted: Record<string, unknown> = {};
  if (!isRecord(headers)) return redacted;
  for (const [name, value] of Object.entries(headers)) {
    const isReference = options.keepTemplates === true && typeof value === 'string' && TEMPLATE_REFERENCE_PATTERN.test(value);
    const hide = SECRET_HEADER_PATTERN.test(name) && !isReference;
    Object.defineProperty(redacted, name, {
      value: hide ? REDACTED_HEADER_VALUE : value,
      enumerable: true,
      writable: true,
      configurable: true,
    });
  }
  return redacted;
}

/**
 * Al editar un paso, una cabecera que vuelve como `[REDACTED]` significa «no la toqué»: se conserva
 * el valor guardado. Sin esto, leer un paso y volver a guardarlo —lo que hace cualquier formulario—
 * reemplazaría la llave real por la cadena `[REDACTED]`.
 */
export function restoreRedactedHeaders(incoming: Record<string, unknown>, stored: unknown): Record<string, unknown> {
  const previous = isRecord(stored) ? stored : {};
  const restored: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(incoming)) {
    const keep = value === REDACTED_HEADER_VALUE && Object.hasOwn(previous, name);
    Object.defineProperty(restored, name, { value: keep ? previous[name] : value, enumerable: true, writable: true, configurable: true });
  }
  return restored;
}
