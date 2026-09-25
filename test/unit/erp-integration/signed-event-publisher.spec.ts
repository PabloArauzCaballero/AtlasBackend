/**
 * @file P-14 — dobles del proveedor para el cliente de entrega de Core al ERP.
 * @business Sólo un 2xx del receptor es entrega; todo lo demás se reintenta o se deja muerto y visible,
 *   con la misma clasificación que el outbox del ERP para que los dos sentidos se comporten igual.
 * @system `fetch` inyectado: 200, 401, 409, 422, 429, 5xx, timeout, red caída y cuerpo malformado.
 */
import { describe, expect, it } from '@jest/globals';
import { SignedEventPublisher, redactDeliveryError } from '../../../src/modules/erp-integration/signed-event-publisher.js';
import { SIGNATURE_HEADER, verifyEventSignature } from '../../../src/platform/security/signed-event.js';

const SECRET = 'prueba-'.repeat(6);
const ENVELOPE = { eventKey: '00000000-0000-4000-8000-000000000021', topic: 'payment.confirmed', payload: { amount: '1.00' } };

function publisherAnswering(answer: number | Error, body = '{}') {
  const seen: Array<{ url: string; init: RequestInit }> = [];
  const publisher = new SignedEventPublisher({
    url: 'http://usuario:clave@erp:3007/api/v1/integration/core/events?x=1',
    secret: SECRET,
    timeoutMs: 50,
    nowSeconds: () => 1_790_251_200,
    fetchImpl: async (url, init) => {
      seen.push({ url, init });
      if (answer instanceof Error) throw answer;
      return new Response(body, { status: answer });
    },
  });
  return { publisher, seen };
}

describe('SignedEventPublisher · clasificación de respuestas del ERP', () => {
  it('200 es ACK y la petición va firmada sobre el cuerpo crudo con clave y tópico en cabeceras', async () => {
    const { publisher, seen } = publisherAnswering(200);
    await expect(publisher.publish(ENVELOPE, 1)).resolves.toEqual({ outcome: 'ACK', httpStatus: 200 });
    const headers = seen[0]!.init.headers as Record<string, string>;
    expect(headers['x-atlas-event-key']).toBe(ENVELOPE.eventKey);
    expect(headers['x-atlas-topic']).toBe('payment.confirmed');
    expect(headers['x-atlas-delivery-attempt']).toBe('1');
    expect(
      verifyEventSignature({
        secret: SECRET,
        header: headers[SIGNATURE_HEADER],
        rawBody: String(seen[0]!.init.body),
        nowSeconds: 1_790_251_200,
        toleranceSeconds: 300,
      }),
    ).toEqual({ ok: true });
  });

  it('un 2xx con cuerpo malformado sigue siendo ACK: el cuerpo nunca se interpreta ni se guarda', async () => {
    const { publisher } = publisherAnswering(202, '<<no es json');
    await expect(publisher.publish(ENVELOPE, 2)).resolves.toEqual({ outcome: 'ACK', httpStatus: 202 });
  });

  it.each([401, 403, 404, 409, 429, 500, 502, 503])('%i es transitorio: RETRY', async (status) => {
    const { publisher } = publisherAnswering(status, 'detalle interno con PII');
    const result = await publisher.publish(ENVELOPE, 1);
    expect(result).toEqual({ outcome: 'RETRY', httpStatus: status, error: `HTTP ${status} del receptor` });
  });

  it.each([400, 410, 413, 415, 422])('%i es rechazo de contrato: REJECTED (va a dead)', async (status) => {
    const { publisher } = publisherAnswering(status);
    await expect(publisher.publish(ENVELOPE, 1)).resolves.toEqual({
      outcome: 'REJECTED',
      httpStatus: status,
      error: `HTTP ${status} del receptor`,
    });
  });

  it('un timeout es RETRY y no ACK', async () => {
    const { publisher } = publisherAnswering(Object.assign(new Error('aborted'), { name: 'TimeoutError' }));
    await expect(publisher.publish(ENVELOPE, 1)).resolves.toEqual({
      outcome: 'RETRY',
      httpStatus: null,
      error: 'timeout: sin respuesta del receptor en 50 ms',
    });
  });

  it('una red caída es RETRY y el error no filtra el secreto ni las credenciales de la URL', async () => {
    const cause = Object.assign(new Error(`connect ECONNREFUSED ${SECRET}`), { name: 'Error', code: 'ECONNREFUSED' });
    const { publisher } = publisherAnswering(Object.assign(new TypeError('fetch failed'), { cause }));
    const result = await publisher.publish(ENVELOPE, 1);
    expect(result).toEqual({ outcome: 'RETRY', httpStatus: null, error: 'red: Error: ECONNREFUSED' });
    expect(redactDeliveryError(`fallo en http://u:p@erp:3007/x?token=1 con ${SECRET} v1=abcdef`, SECRET)).toBe(
      'fallo en http://erp:3007/… con [secreto] v1=[redactado]',
    );
  });

  it('sin causa, el mensaje del error de red se redacta', async () => {
    const { publisher } = publisherAnswering(new Error(`caída en http://u:p@erp/x ${SECRET}`));
    const result = await publisher.publish(ENVELOPE, 1);
    expect(result).toEqual({ outcome: 'RETRY', httpStatus: null, error: 'red: caída en http://erp/… [secreto]' });
  });
});
