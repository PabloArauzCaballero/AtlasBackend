/**
 * @file Firma HMAC de eventos entre servicios (P-14): el MISMO esquema que el outbox del ERP.
 * @business Un evento de dinero que llega de otro servicio sólo se acepta si lo firmó quien comparte el
 *   secreto de ESE sentido y si la firma es reciente: capturar una petición no permite repetirla después.
 * @system `x-atlas-signature: t=<unix>,v1=<hex(HMAC-SHA256(secreto, "<t>.<cuerpo crudo>"))>`. Se verifica
 *   sobre los bytes tal cual llegaron (re-serializar cambia espacios y orden de claves), en tiempo
 *   constante y con ventana de frescura. Vectores de prueba en contracts/atlas-integration-v1/signature.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';

export const SIGNATURE_HEADER = 'x-atlas-signature';
export const EVENT_KEY_HEADER = 'x-atlas-event-key';
export const TOPIC_HEADER = 'x-atlas-topic';
export const ATTEMPT_HEADER = 'x-atlas-delivery-attempt';

export function signEventBody(secret: string, rawBody: string, timestampSeconds: number): string {
  const digest = createHmac('sha256', secret).update(`${timestampSeconds}.${rawBody}`).digest('hex');
  return `t=${timestampSeconds},v1=${digest}`;
}

export type SignatureVerdict = Readonly<{ ok: true } | { ok: false; reason: 'MISSING' | 'MALFORMED' | 'EXPIRED' | 'MISMATCH' }>;

export function verifyEventSignature(input: {
  secret: string;
  header: string | undefined | null;
  rawBody: string;
  nowSeconds?: number;
  toleranceSeconds: number;
}): SignatureVerdict {
  if (!input.header) return { ok: false, reason: 'MISSING' };
  const parts = new Map(
    input.header.split(',').map((part) => {
      const [key, ...rest] = part.trim().split('=');
      return [key, rest.join('=')] as const;
    }),
  );
  const timestamp = Number(parts.get('t'));
  const received = parts.get('v1');
  if (!Number.isInteger(timestamp) || !received || !/^[0-9a-f]{64}$/u.test(received)) return { ok: false, reason: 'MALFORMED' };
  const now = input.nowSeconds ?? Math.floor(Date.now() / 1000);
  if (Math.abs(now - timestamp) > input.toleranceSeconds) return { ok: false, reason: 'EXPIRED' };
  const expected = createHmac('sha256', input.secret).update(`${timestamp}.${input.rawBody}`).digest();
  return timingSafeEqual(expected, Buffer.from(received, 'hex')) ? { ok: true } : { ok: false, reason: 'MISMATCH' };
}
