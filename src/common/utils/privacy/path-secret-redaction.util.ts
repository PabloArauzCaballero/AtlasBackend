/**
 * Redacción de secretos que viajan en un SEGMENTO DE RUTA.
 *
 * `redactSensitiveObject` redacta por nombre de clave y `sanitizeUrlForLog` sólo los valores de la
 * query, así que un secreto puesto en la ruta (`/brevo-sms-events/<secreto>`: Brevo no deja añadir
 * cabeceras ni firma el cuerpo) acababa en claro en `http_action_logs`, en el outbox de comandos y en
 * el log de excepciones. Aquí se reemplaza ese segmento por `[REDACTED]` antes de guardar la ruta.
 */
const SECRET_PATH_SEGMENTS: readonly RegExp[] = [/(\/internal\/notifications\/brevo-sms-events\/)[^/?#]+/gi];

export function redactPathSecrets(path: string): string {
  return SECRET_PATH_SEGMENTS.reduce((current, pattern) => current.replace(pattern, '$1[REDACTED]'), path);
}
