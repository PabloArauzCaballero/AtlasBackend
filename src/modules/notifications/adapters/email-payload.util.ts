/**
 * @file Utilidad pura o acotada reutilizable dentro de su capa.
 * @business Esta pieza entrega mensajes oportunos y respetuosos de preferencias por canales configurables.
 * @system lee del payload los campos de correo que no viajan en el mensaje (html, copias, reply-to).
 */

/**
 * De dónde salen el HTML, las copias y el `reply-to` de un correo.
 *
 * `NotificationMessagePayload` sólo tiene `subject`, `title` y un `body` de texto: lo demás viaja en
 * `payload`, con la clave que puso quien encoló el mensaje. Estas dos funciones fijan ESAS claves en
 * un sitio, para que un correo encolado con `htmlBody` no llegue en HTML por Gmail y en texto plano
 * por SendGrid — que es exactamente lo que pasaba cuando cada adaptador leía el payload a su manera.
 */
export function readString(payload: Record<string, unknown>, ...keys: string[]): string | null {
  for (const key of keys) {
    const value = payload[key];
    if (typeof value === 'string' && value.trim().length > 0) return value.trim();
  }
  return null;
}

/** `cc`/`bcc` llegan del payload como string suelto o como lista; se normalizan a lista. */
export function readAddressList(payload: Record<string, unknown>, key: string): string[] {
  const value = payload[key];
  if (typeof value === 'string') return value.split(',').map((entry) => entry.trim());
  if (Array.isArray(value)) return value.filter((entry): entry is string => typeof entry === 'string').map((entry) => entry.trim());
  return [];
}

/** El cuerpo HTML del correo, si quien lo encoló puso uno. */
export function readHtmlBody(payload: Record<string, unknown>): string | null {
  return readString(payload, 'html', 'htmlBody');
}
