/**
 * @file Utilidad pura o acotada reutilizable dentro de su capa.
 * @business Esta pieza hace que el dato del mensaje —el código, el monto, el nombre— llegue dentro de la plantilla.
 * @system traduce el payload de ATLAS a la plantilla y los `params` que espera Brevo para WhatsApp.
 */

/** La plantilla que pide un mensaje concreto, si trae una. Brevo la identifica por número. */
export function brevoTemplateId(value: unknown): number | null {
  if (typeof value === 'number' && Number.isInteger(value) && value > 0) return value;
  if (typeof value === 'string' && /^[0-9]+$/u.test(value.trim())) {
    const parsed = Number.parseInt(value.trim(), 10);
    return parsed > 0 ? parsed : null;
  }
  return null;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function scalar(value: unknown): string | null {
  if (typeof value === 'string' && value.trim().length > 0) return value.trim();
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return null;
}

/**
 * Los huecos de la plantilla, con el nombre que Brevo espera.
 *
 * Brevo los quiere NOMBRADOS (`{"codigo":"482913"}` para un `{{params.codigo}}` en la plantilla),
 * mientras que Meta Cloud los quiere POSICIONALES (una lista que rellena `{{1}}`, `{{2}}`). Los dos
 * formatos conviven en el payload a propósito: un mismo mensaje tiene que poder salir por cualquiera
 * de los dos proveedores sin que quien lo compone sepa cuál está activo hoy.
 *
 * `whatsappTemplateParams` es el camino bueno. La lista posicional se acepta como respaldo y se
 * convierte a `{"1":…,"2":…}`, que es lo que se puede hacer sin inventarse nombres: si la plantilla
 * de Brevo usa nombres, esa conversión NO la rellenará, y es preferible a mandar basura con el
 * nombre equivocado.
 */
export function brevoTemplateParams(payload: Record<string, unknown>): Record<string, string> {
  const nombrados = payload.whatsappTemplateParams;
  if (isPlainObject(nombrados)) {
    const resultado: Record<string, string> = {};
    for (const [clave, valor] of Object.entries(nombrados)) {
      const texto = scalar(valor);
      if (texto !== null) resultado[clave] = texto;
    }
    return resultado;
  }
  const posicionales = payload.whatsappTemplateParameters;
  if (!Array.isArray(posicionales)) return {};
  const resultado: Record<string, string> = {};
  posicionales.forEach((valor, indice) => {
    const texto = scalar(valor);
    if (texto !== null) resultado[String(indice + 1)] = texto;
  });
  return resultado;
}
