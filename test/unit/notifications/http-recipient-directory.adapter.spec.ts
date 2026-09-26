/**
 * @file AT-057 — el directorio por HTTP falla CERRADO: ningún fallo se convierte en una dirección.
 * @business Si Clientes no responde, responde 4xx/5xx o devuelve algo raro, Mensajería trata al destinatario
 *   como no entregable. Nunca inventa una dirección, nunca reintenta a ciegas dentro de la llamada.
 * @system `fetch` sustituido por un doble; se asertan la URL, el Bearer de servicio atado al recurso y el
 *   tiempo límite. Sin red ni base.
 */
import { describe, expect, it, jest } from '@jest/globals';
import {
  HttpRecipientDirectoryAdapter,
  RECIPIENT_DIRECTORY_HTTP_TIMEOUT_MS,
} from '../../../src/modules/notifications/infrastructure/directory/http-recipient-directory.adapter.js';
import { RemoteRecipientDirectoryAdapter } from '../../../src/modules/notifications/infrastructure/directory/remote-recipient-directory.adapter.js';
import { resourceFingerprint, verifyServiceToken } from '../../../src/platform/security/service-token.js';

const SCOPE = 'customers:recipient-directory';
const lookup = { tenantId: '3', recipient: { type: 'customer' as const, id: '42' }, channel: 'sms' as const };

function adapterWith(responder: (url: string, init?: RequestInit) => unknown) {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const fetchImpl = jest.fn(async (input: unknown, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init });
    const result = responder(url, init);
    if (result instanceof Error) throw result;
    return result as Response;
  });
  const adapter = new HttpRecipientDirectoryAdapter({
    baseUrl: 'http://api:3005/api/v1/',
    service: 'messaging-worker',
    scope: SCOPE,
    fetchImpl: fetchImpl as unknown as typeof fetch,
    timeoutMs: 50,
  });
  return { adapter, calls };
}

const ok = (body: unknown) => ({ ok: true, status: 200, json: async () => body }) as unknown as Response;

describe('directorio de destinatarios por HTTP', () => {
  it('pide la ruta del contrato con el token de servicio firmado PARA ESE recurso', async () => {
    const { adapter, calls } = adapterWith(() =>
      ok({ addresses: [{ contactId: '7', kind: 'phone', address: '+59170000001', resolvedAt: 'x' }] }),
    );
    const addresses = await adapter.resolveDeliveryAddresses({ ...lookup, purpose: 'transactional' });
    expect(addresses).toEqual([{ contactId: '7', kind: 'phone', address: '+59170000001', resolvedAt: 'x' }]);
    expect(calls).toHaveLength(1);
    // Sin barra doble aunque la base venga con barra final, y con los parámetros en la query.
    expect(calls[0].url).toBe(
      'http://api:3005/api/v1/internal/contexts/customers/recipient-directory/addresses?customerId=42&channel=sms&purpose=transactional',
    );
    const token = String((calls[0].init?.headers as Record<string, string>).authorization).replace('Bearer ', '');
    const verification = verifyServiceToken(token, {
      audienceContext: 'customers',
      scope: SCOPE,
      allowedServices: ['messaging-worker'],
      resource: resourceFingerprint({ customerId: '42', channel: 'sms', purpose: 'transactional' }),
    });
    expect(verification).toMatchObject({ ok: true, claims: { service: 'messaging-worker', tenantId: '3' } });
  });

  it('acepta la respuesta con y sin el sobre `data` de la API', async () => {
    const envelope = adapterWith(() => ok({ data: { status: 'available', contactId: '9', resolvedAt: 'x' } }));
    expect(await envelope.adapter.resolve(lookup)).toMatchObject({ status: 'available', contactId: '9' });
    const bare = adapterWith(() => ok({ status: 'unverified', contactId: '9', resolvedAt: 'x' }));
    expect(await bare.adapter.resolve(lookup)).toMatchObject({ status: 'unverified' });
  });

  it('respuesta no 2xx, error de red o tiempo límite: no entregable, sin excepción hacia el orquestador', async () => {
    const denied = adapterWith(() => ({ ok: false, status: 403, json: async () => ({}) }) as unknown as Response);
    expect(await denied.adapter.resolveDeliveryAddresses({ ...lookup, purpose: 'transactional' })).toEqual([]);
    expect(await denied.adapter.resolve(lookup)).toMatchObject({ status: 'unsupported', contactId: null });

    const broken = adapterWith(() => new Error('ECONNREFUSED'));
    expect(await broken.adapter.resolveDeliveryAddresses({ ...lookup, purpose: 'transactional' })).toEqual([]);

    const garbage = adapterWith(
      () =>
        ({
          ok: true,
          status: 200,
          json: async () => {
            throw new Error('cuerpo no es JSON');
          },
        }) as unknown as Response,
    );
    expect(await garbage.adapter.resolve(lookup)).toMatchObject({ status: 'unsupported' });
  });

  it('un destinatario que no es cliente no genera llamada alguna', async () => {
    const { adapter, calls } = adapterWith(() => ok({}));
    expect(await adapter.resolve({ ...lookup, recipient: { type: 'internal_user', id: '1' } })).toMatchObject({ status: 'unsupported' });
    expect(
      await adapter.resolveDeliveryAddresses({ ...lookup, recipient: { type: 'internal_user', id: '1' }, purpose: 'transactional' }),
    ).toEqual([]);
    expect(calls).toEqual([]);
  });

  it('el tiempo límite por defecto está acotado a segundos, no a minutos', () => {
    expect(RECIPIENT_DIRECTORY_HTTP_TIMEOUT_MS).toBeLessThanOrEqual(5000);
  });
});

describe('directorio remoto sin configurar (hueco declarado)', () => {
  it('devuelve no soportado y ninguna dirección: el piloto no entrega a clientes hasta que haya contrato', async () => {
    const adapter = new RemoteRecipientDirectoryAdapter();
    expect(await adapter.resolve(lookup)).toMatchObject({ status: 'unsupported', contactId: null });
    expect(await adapter.resolveDeliveryAddresses({ ...lookup, purpose: 'transactional' })).toEqual([]);
  });
});
