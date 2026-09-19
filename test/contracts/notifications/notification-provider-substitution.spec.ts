/**
 * @file AT-044 — sustitución de proveedores de notificación: un servidor controlado simula timeout, 429, 5xx
 *   y respuesta malformada; el adaptador OTP clasifica sin éxito ficticio y no degrada a mock en producción.
 * @business Timeout → incierto; 429/5xx → fallo reintentable; malformado → fallo de contrato; sin
 *   credenciales en producción → fallo cerrado, no mock silencioso.
 * @system `node:http` local (sin depender de AtlasExternalProvidersMock) + adaptador de canal de prueba
 *   que habla HTTP; la clasificación es la de `classifyDeliveryError`.
 */
import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { createServer, type Server } from 'node:http';
import type { NotificationChannelAdapter } from '../../../src/modules/notifications/adapters/notification-channel-adapter.js';
import { LocalOtpDeliveryAdapter } from '../../../src/modules/notifications/infrastructure/local-otp-delivery.adapter.js';
import { OTP_ERRORS } from '../../../src/modules/notifications/public/index.js';

let server: Server;
let baseUrl = '';
let mode: 'ok' | 'timeout' | '429' | '500' | 'malformed' = 'ok';

beforeAll(async () => {
  server = createServer((req, res) => {
    if (mode === 'timeout') return; // nunca responde: el cliente aborta
    if (mode === '429') {
      res.writeHead(429).end('{"error":"rate"}');
      return;
    }
    if (mode === '500') {
      res.writeHead(500).end('{"error":"boom"}');
      return;
    }
    if (mode === 'malformed') {
      res.writeHead(200).end('<html>');
      return;
    }
    res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ id: 'msg-1', status: 'sent' }));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  baseUrl = typeof address === 'object' && address ? `http://127.0.0.1:${address.port}` : '';
});
afterAll(async () => {
  server.closeAllConnections?.();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

/** Canal SMS de prueba que habla HTTP con el proveedor simulado; misma interfaz que los reales. */
function httpSmsAdapter(): NotificationChannelAdapter {
  return {
    getProviderName: () => 'http-sim',
    supports: (c) => c === 'sms',
    validatePayload: () => true,
    send: async (message) => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 200);
      try {
        const response = await fetch(`${baseUrl}/send`, {
          method: 'POST',
          body: JSON.stringify({ to: message.deliveryTargets?.[0]?.address }),
          signal: controller.signal,
        });
        const text = await response.text();
        if (response.status === 429)
          return { status: 'failed', provider: 'http-sim', errorCode: 'RATE_LIMITED', errorMessage: 'retry later' };
        if (response.status >= 500)
          return { status: 'failed', provider: 'http-sim', errorCode: 'PROVIDER_ERROR', errorMessage: text.slice(0, 40) };
        let parsed: { status?: string };
        try {
          parsed = JSON.parse(text) as { status?: string };
        } catch {
          return { status: 'failed', provider: 'http-sim', errorCode: 'MALFORMED_RESPONSE' };
        }
        return { status: parsed.status === 'sent' ? 'sent' : 'failed', provider: 'http-sim' };
      } catch (error) {
        throw new Error(`request timed out: ${(error as Error).name}`, { cause: error });
      } finally {
        clearTimeout(timer);
      }
    },
  };
}

const request = {
  tenantId: '1',
  customerId: '42',
  channel: 'sms' as const,
  destination: '+59170000001',
  code: '123456',
  ttlMinutes: 10,
  reference: 'r-1',
  expiresAt: new Date(Date.now() + 600_000),
};
const mail = { isEnabled: () => false, sendContactVerificationCode: async () => undefined };
const whatsapp = { getProviderName: () => 'disabled', send: async () => ({ status: 'failed', provider: 'disabled' }) };

describe('sustitución de proveedor de notificación (AT-044)', () => {
  const adapter = () => new LocalOtpDeliveryAdapter(mail as never, httpSmsAdapter() as never, whatsapp as never);
  it('proveedor sano: entregado', async () => {
    mode = 'ok';
    expect((await adapter().deliver(request)).delivered).toBe(true);
  });
  it('timeout: incierto, no fallo definitivo ni éxito', async () => {
    mode = 'timeout';
    expect(await adapter().deliver(request)).toMatchObject({ delivered: false, uncertain: true, errorCode: OTP_ERRORS.uncertain });
  });
  it('429: fallo reintentable clasificado, no éxito ficticio', async () => {
    mode = '429';
    expect(await adapter().deliver(request)).toMatchObject({ delivered: false, uncertain: false, errorCode: 'RATE_LIMITED' });
  });
  it('5xx: fallo del proveedor', async () => {
    mode = '500';
    expect(await adapter().deliver(request)).toMatchObject({ delivered: false, errorCode: 'PROVIDER_ERROR' });
  });
  it('respuesta malformada: error de contrato', async () => {
    mode = 'malformed';
    expect(await adapter().deliver(request)).toMatchObject({ delivered: false, errorCode: 'MALFORMED_RESPONSE' });
  });
  it('proveedor apagado (producción sin credenciales): fallo cerrado, no cambia a mock', async () => {
    const closed = new LocalOtpDeliveryAdapter(
      mail as never,
      { getProviderName: () => 'disabled', send: async () => ({ status: 'failed', provider: 'disabled_sms' }) } as never,
      whatsapp as never,
    );
    expect(await closed.deliver(request)).toMatchObject({ delivered: false, errorCode: OTP_ERRORS.unsupported });
  });
});
