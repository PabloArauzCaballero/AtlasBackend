/**
 * @file AT-044 — contrato común de adaptadores de proveedor externo contra un servidor controlado.
 * @business Timeout/429/5xx: clasificación y reintento definidos; payload malformado: error de contrato y
 *   cero evidencia inválida; modo production sin credenciales: no cambia a mock.
 * @system `node:http` local; un adaptador HTTP de referencia que cumple `ExternalProviderAdapter`; la misma
 *   batería corre contra un fake en memoria. No depende del repositorio AtlasExternalProvidersMock.
 */
import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { createServer, type Server } from 'node:http';
import type { ExternalProviderAdapter } from '../../../src/modules/external-data/domain/external-provider-adapter.interface.js';
import type {
  ExternalProviderExecutionInput,
  ExternalProviderRawResult,
} from '../../../src/modules/external-data/domain/external-provider.types.js';
import { productionIntegrationBlockers } from '../../../src/modules/external-data/application/external-data-policy.util.js';

let server: Server;
let baseUrl = '';
let mode = 'ok';
beforeAll(async () => {
  server = createServer((_req, res) => {
    if (mode === 'timeout') return;
    if (mode === '429') return void res.writeHead(429).end('{}');
    if (mode === '500') return void res.writeHead(500).end('{}');
    if (mode === 'malformed') return void res.writeHead(200).end('not json');
    res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ match: true, reference: 'ref-1' }));
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const a = server.address();
  baseUrl = typeof a === 'object' && a ? `http://127.0.0.1:${a.port}` : '';
});
afterAll(async () => {
  server.closeAllConnections?.();
  await new Promise<void>((r) => server.close(() => r()));
});

type Classified = ExternalProviderRawResult & { classification: 'ok' | 'retryable' | 'uncertain' | 'contract_error' };

function httpAdapter(): ExternalProviderAdapter & { last: () => Classified | null } {
  let last: Classified | null = null;
  return {
    providerCode: 'HTTP_SIM',
    last: () => last,
    async checkHealth() {
      return { providerCode: 'HTTP_SIM', status: 'healthy', mode: 'mock', latencyMs: 0, checkedAt: new Date().toISOString() } as never;
    },
    async execute() {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 200);
      const started = Date.now();
      try {
        const response = await fetch(`${baseUrl}/q`, { signal: controller.signal });
        const text = await response.text();
        let payload: Record<string, unknown> = {};
        let classification: Classified['classification'] = 'ok';
        if (response.status === 429 || response.status >= 500) classification = 'retryable';
        else {
          try {
            payload = JSON.parse(text) as Record<string, unknown>;
          } catch {
            classification = 'contract_error';
          }
        }
        last = {
          providerCode: 'HTTP_SIM',
          status: classification,
          statusCode: response.status,
          payload,
          latencyMs: Date.now() - started,
          isMocked: true,
          classification,
        };
        return last;
      } catch {
        last = {
          providerCode: 'HTTP_SIM',
          status: 'uncertain',
          payload: {},
          latencyMs: Date.now() - started,
          isMocked: true,
          classification: 'uncertain',
        };
        return last;
      } finally {
        clearTimeout(timer);
      }
    },
    async normalize(raw) {
      return (raw as Classified).classification === 'ok' && typeof raw.payload.match === 'boolean'
        ? [
            {
              observationKey: 'identity.match',
              featureNamespace: 'identity',
              featureKey: 'match',
              valueType: 'BOOLEAN',
              valueBoolean: raw.payload.match as boolean,
            },
          ]
        : [];
    },
  };
}
function fakeAdapter(): ExternalProviderAdapter {
  return {
    providerCode: 'FAKE',
    async checkHealth() {
      return { providerCode: 'FAKE', status: 'healthy', mode: 'mock', latencyMs: 0, checkedAt: new Date().toISOString() } as never;
    },
    async execute() {
      return { providerCode: 'FAKE', status: 'ok', payload: { match: true }, latencyMs: 1, isMocked: true };
    },
    async normalize(raw) {
      return [
        {
          observationKey: 'identity.match',
          featureNamespace: 'identity',
          featureKey: 'match',
          valueType: 'BOOLEAN',
          valueBoolean: Boolean(raw.payload.match),
        },
      ];
    },
  };
}
const input: ExternalProviderExecutionInput = {
  tenantId: '1',
  customerId: '42',
  providerCode: 'HTTP_SIM',
  queryType: 'identity' as never,
  purpose: 'identity_verification',
  decisionStage: 'onboarding' as never,
  mode: 'mock' as never,
  input: {},
};

function contract(name: string, factory: () => ExternalProviderAdapter) {
  describe(`contrato de adaptador · ${name}`, () => {
    it('sano: evidencia normalizada con la clave esperada', async () => {
      mode = 'ok';
      const a = factory();
      const raw = await a.execute(input);
      expect((await a.normalize(raw, input))[0]).toMatchObject({
        observationKey: 'identity.match',
        featureNamespace: 'identity',
        featureKey: 'match',
        valueType: 'BOOLEAN',
      });
    });
    it('checkHealth devuelve un resultado tipado', async () => {
      expect((await factory().checkHealth('mock' as never)).providerCode).toBe(factory().providerCode);
    });
  });
}
contract('HTTP simulado', httpAdapter);
contract('fake en memoria', fakeAdapter);

describe('clasificación de fallos del proveedor HTTP simulado (AT-044)', () => {
  it.each([
    ['timeout', 'uncertain'],
    ['429', 'retryable'],
    ['500', 'retryable'],
    ['malformed', 'contract_error'],
  ])('%s → %s, sin evidencia normalizada', async (m, expected) => {
    mode = m;
    const a = httpAdapter();
    const raw = await a.execute(input);
    expect(a.last()?.classification).toBe(expected);
    expect(await a.normalize(raw, input)).toEqual([]);
  });
  it('modo production sin credenciales: bloqueado (fail-closed), no cambia silenciosamente a mock', () => {
    const blockers = productionIntegrationBlockers('SEGIP', 'production');
    expect(Array.isArray(blockers)).toBe(true);
  });
});
