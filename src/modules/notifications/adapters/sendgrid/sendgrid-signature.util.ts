/**
 * @file Utilidad pura o acotada reutilizable dentro de su capa.
 * @business Esta pieza impide que un tercero marque como rebotado un correo y silencie a un cliente.
 * @system verifica la firma ECDSA del Event Webhook de SendGrid sobre el cuerpo CRUDO.
 */
import { createPublicKey, createVerify, type KeyObject } from 'node:crypto';

export const SENDGRID_SIGNATURE_HEADER = 'x-twilio-email-event-webhook-signature';
export const SENDGRID_TIMESTAMP_HEADER = 'x-twilio-email-event-webhook-timestamp';

/** Margen por defecto para el reloj y el tránsito. Fuera de él, el evento se rechaza por repetición. */
export const SENDGRID_TIMESTAMP_TOLERANCE_S = 600;

function publicKeyFrom(base64Key: string): KeyObject | null {
  try {
    return createPublicKey({ key: Buffer.from(base64Key, 'base64'), format: 'der', type: 'spki' });
  } catch {
    // Una llave mal copiada es un error de configuración, no una petición inválida: el llamador lo
    // traduce a «webhook no configurado» en vez de tratarlo como un intento de falsificación.
    return null;
  }
}

/**
 * ¿Firmó SendGrid este cuerpo?
 *
 * La firma es ECDSA sobre `timestamp + cuerpo CRUDO`, así que hay que verificar los bytes tal cual
 * llegaron: si se verifica sobre el JSON re-serializado por el parser, la firma no cuadra nunca
 * —basta un espacio o un orden de claves distinto— y el webhook queda «roto» sin explicación.
 *
 * El `timestamp` se comprueba además contra el reloj: una firma válida sigue siéndolo para siempre,
 * y sin ventana un evento capturado se puede reenviar mañana para marcar como rebotado un correo
 * que sí llegó.
 */
export function isValidSendGridSignature(input: {
  publicKey: string;
  signature: string | undefined;
  timestamp: string | undefined;
  rawBody: Buffer | string;
  nowSeconds?: number;
  toleranceSeconds?: number;
}): boolean {
  if (!input.signature || !input.timestamp) return false;
  const emitido = Number(input.timestamp);
  if (!Number.isFinite(emitido)) return false;
  const ahora = input.nowSeconds ?? Math.floor(Date.now() / 1000);
  const tolerancia = input.toleranceSeconds ?? SENDGRID_TIMESTAMP_TOLERANCE_S;
  if (Math.abs(ahora - emitido) > tolerancia) return false;

  const key = publicKeyFrom(input.publicKey);
  if (!key) return false;
  const cuerpo = typeof input.rawBody === 'string' ? Buffer.from(input.rawBody, 'utf8') : input.rawBody;
  const verificador = createVerify('sha256');
  verificador.update(Buffer.concat([Buffer.from(input.timestamp, 'utf8'), cuerpo]));
  verificador.end();
  try {
    return verificador.verify(key, Buffer.from(input.signature, 'base64'));
  } catch {
    // `verify` lanza ante una firma que ni siquiera es DER; para el llamador es lo mismo que falsa.
    return false;
  }
}
