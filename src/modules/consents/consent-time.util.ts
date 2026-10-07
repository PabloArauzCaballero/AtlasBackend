/**
 * @file Utilidad pura: decide la hora que queda como prueba de un consentimiento.
 * @business La fecha de una aceptación es evidencia ante el regulador: no puede dictarla quien acepta.
 * @system acota la hora que reporta el cliente a una ventana corta anterior a la del servidor.
 */

/** Cuánto atrás se le cree a la hora del dispositivo (captura sin conexión que se envía después). */
export const CLIENT_CONSENT_TIME_WINDOW_MS = 24 * 3_600_000;

/**
 * Hora con la que se guarda el consentimiento.
 *
 * La del cliente sólo vale si cae entre `ahora - 24 h` y `ahora`: ni futura ni de antes de que existiera
 * el documento. Fuera de esa ventana manda la del servidor, sin rechazar la petición (el consentimiento sí
 * se dio; lo que no se acepta es la fecha que declara).
 */
export function consentHappenedAt(clientReportedAt: string | undefined, now: Date): Date {
  if (!clientReportedAt) return now;
  const reported = new Date(clientReportedAt);
  const time = reported.getTime();
  if (Number.isNaN(time) || time > now.getTime() || time < now.getTime() - CLIENT_CONSENT_TIME_WINDOW_MS) return now;
  return reported;
}
