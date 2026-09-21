/**
 * @file Contrato backend ↔ AtlasExternalProvidersMock, con el emulador REAL y los adaptadores reales.
 * @business Cada proveedor contesta lo que su normalizador necesita; un escenario que el proveedor no
 *   representa NO devuelve camino feliz; dos personas de la misma corrida no comparten estado; y el
 *   journal del emulador prueba que la llamada salió por la red.
 * @system Levanta `../AtlasExternalProvidersMock/src/server.mjs` en un puerto efímero con su plano de
 *   control, y ejecuta `adapter.execute()`/`adapter.normalize()` sin interceptar `fetch`.
 *
 * Por qué existe además de `external-provider-adapter.contract.spec.ts`: aquella prueba usa un
 * servidor `node:http` propio para no depender del repositorio del emulador, y eso es correcto para
 * las reglas del adaptador (timeout, 429, payload malformado). Pero deja sin comprobar justo lo que
 * más se rompe entre dos repositorios: que los CAMPOS que el emulador emite sean los que el
 * normalizador lee. Un `matchScore` renombrado en el emulador pasa aquella suite en verde y llega a
 * `dev` como un expediente KYC con confianza 0.
 *
 * Y hay un motivo más fuerte: el paquete QA pide distinguir un E2E real de uno que interceptó
 * `fetch`. Esta suite no puede fingir: si el tráfico no sale, el journal del emulador está vacío y
 * las aserciones de evidencia fallan.
 */
import { describe, expect, it, beforeAll, afterAll } from '@jest/globals';
import { spawn, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { SegipAdapter } from '../../../src/modules/external-data/infrastructure/adapters/segip/segip.adapter.js';
import { InfoCenterAdapter } from '../../../src/modules/external-data/infrastructure/adapters/infocenter/infocenter.adapter.js';
import { QrGenericAdapter } from '../../../src/modules/external-data/infrastructure/adapters/qr-generic/qr-generic.adapter.js';
import { BankingGenericAdapter } from '../../../src/modules/external-data/infrastructure/adapters/banking-generic/banking-generic.adapter.js';
import { TelcoGenericAdapter } from '../../../src/modules/external-data/infrastructure/adapters/telco-generic/telco-generic.adapter.js';
import { FacebookMetaAdapter } from '../../../src/modules/external-data/infrastructure/adapters/facebook-meta/facebook-meta.adapter.js';
import { WhatsappAdapter } from '../../../src/modules/external-data/infrastructure/adapters/whatsapp/whatsapp.adapter.js';
import { DigitalTrustGenericAdapter } from '../../../src/modules/external-data/infrastructure/adapters/digital-trust-generic/digital-trust-generic.adapter.js';
import type { ExternalProviderAdapter } from '../../../src/modules/external-data/domain/external-provider-adapter.interface.js';
import type { ExternalProviderExecutionInput, QueryType } from '../../../src/modules/external-data/domain/external-provider.types.js';
import { validateProviderResponse } from '../../../src/modules/external-data/domain/provider-response.contract.js';

const MOCK_REPO = join(process.cwd(), '..', 'AtlasExternalProvidersMock');
const MOCK_ENTRYPOINT = join(MOCK_REPO, 'src', 'server.mjs');
const CONTROL_TOKEN = 'contrato-backend-emulador-token';

/**
 * El emulador vive en un repositorio hermano. Si no está clonado, esta suite NO puede afirmar nada
 * y se salta con un motivo visible — pero `ATLAS_REQUIRE_PROVIDERS_MOCK=1` la vuelve obligatoria,
 * que es como tiene que correr el pipeline que declara cubierto este contrato. El paquete QA es
 * explícito: un repositorio ausente se reporta BLOCKED, no verde.
 */
const mockRepoPresent = existsSync(MOCK_ENTRYPOINT);
if (!mockRepoPresent && process.env.ATLAS_REQUIRE_PROVIDERS_MOCK === '1') {
  throw new Error(
    `ATLAS_REQUIRE_PROVIDERS_MOCK=1 pero no se encontró ${MOCK_ENTRYPOINT}. ` +
      'Clona AtlasExternalProvidersMock como repositorio hermano antes de declarar cubierto este contrato.',
  );
}
const describeWithMock = mockRepoPresent ? describe : describe.skip;

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address();
      const port = typeof address === 'object' && address !== null ? address.port : 0;
      probe.close(() => resolve(port));
    });
  });
}

async function waitForHealth(base: string, child: ChildProcess, timeoutMs = 15_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`el emulador terminó al arrancar con código ${child.exitCode}`);
    try {
      const response = await fetch(`${base}/mock/ready`);
      if (response.ok) return;
    } catch {
      // todavía no escucha
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`el emulador no respondió en ${timeoutMs} ms`);
}

type Journal = {
  entries: Array<{ provider: string; personaKey: string | null; runId: string | null; scenario: string; statusCode: number; type: string }>;
  totalAppended: number;
};

describeWithMock('contrato backend ↔ emulador de proveedores (AtlasExternalProvidersMock)', () => {
  let child: ChildProcess;
  let base: string;
  let runToken: string;
  const tenantId = 'tenant-contrato';
  const runId = 'run-contrato';

  const controlHeaders = () => ({
    authorization: `Bearer ${CONTROL_TOKEN}`,
    'x-mock-tenant-id': tenantId,
    'content-type': 'application/json',
  });

  async function journal(): Promise<Journal> {
    const response = await fetch(`${base}/mock/control/runs/${runId}/journal?limit=1000`, { headers: controlHeaders() });
    return (await response.json()) as Journal;
  }

  function executionInput(overrides: Partial<ExternalProviderExecutionInput> & { providerCode: string; queryType: QueryType }) {
    const { providerCode, queryType, ...rest } = overrides;
    const slug: Record<string, string> = {
      SEGIP: 'segip',
      INFOCENTER: 'infocenter',
      QR_GENERIC: 'qr',
      BANKING_GENERIC: 'banking',
      TELCO_GENERIC: 'telco',
      FACEBOOK_META: 'facebook',
      WHATSAPP_GENERIC: 'whatsapp',
      DIGITAL_TRUST_GENERIC: 'digital-trust',
    };
    return {
      tenantId: '1',
      providerCode,
      queryType,
      purpose: 'contract-test',
      decisionStage: 'ONBOARDING',
      mode: 'mock_server',
      input: {},
      mockBaseUrl: `${base}/mock/${slug[providerCode]}`,
      qaContext: { tenantId, runId, runToken, personaKey: 'p-contrato' },
      ...rest,
    } as ExternalProviderExecutionInput;
  }

  beforeAll(async () => {
    const port = await freePort();
    base = `http://127.0.0.1:${port}`;
    child = spawn(process.execPath, [MOCK_ENTRYPOINT], {
      env: {
        ...process.env,
        MOCK_PROVIDERS_PORT: String(port),
        MOCK_PROVIDERS_CONTROL_TOKEN: CONTROL_TOKEN,
        // Latencia a cero: esta suite comprueba CONTRATO, y esperar los 900–2500 ms reales del buró
        // ocho veces sólo añade minutos sin añadir una sola aserción.
        MOCK_PROVIDERS_MAX_LATENCY_MS: '0',
        MOCK_PROVIDERS_DEFAULT_LATENCY_MS: '0',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    await waitForHealth(base, child);

    const created = await fetch(`${base}/mock/control/runs`, {
      method: 'POST',
      headers: controlHeaders(),
      body: JSON.stringify({ tenantId, runId, seed: 'contrato-1' }),
    });
    expect(created.status).toBe(201);
    runToken = ((await created.json()) as { runToken: string }).runToken;
  }, 30_000);

  afterAll(() => {
    child?.kill();
  });

  /**
   * El caso que justifica la suite entera: que los campos que emite el emulador sean los que lee el
   * normalizador. Cada fila lleva el `input` que esa operación necesita para responder algo
   * coherente, porque desde 2.0 el emulador devuelve el monto que se le pide en vez de un 600 fijo.
   */
  const providers: Array<{
    name: string;
    adapter: ExternalProviderAdapter;
    providerCode: string;
    queryType: QueryType;
    input: Record<string, unknown>;
    expectVerdict: string;
  }> = [
    {
      name: 'SEGIP',
      adapter: new SegipAdapter(),
      providerCode: 'SEGIP',
      queryType: 'IDENTITY_VERIFICATION',
      input: { documentNumber: '8891234' },
      expectVerdict: 'FOUND',
    },
    {
      name: 'INFOCENTER',
      adapter: new InfoCenterAdapter(),
      providerCode: 'INFOCENTER',
      queryType: 'CREDIT_REPORT',
      input: { documentNumber: '8891234' },
      expectVerdict: 'COMPLETED',
    },
    {
      name: 'QR_GENERIC',
      adapter: new QrGenericAdapter(),
      providerCode: 'QR_GENERIC',
      queryType: 'PAYMENT_VERIFICATION',
      input: { amount: 1250.5, currency: 'BOB', reference: 'PAGO-CONTRATO' },
      expectVerdict: 'PAYMENT_VERIFIED',
    },
    {
      name: 'BANKING_GENERIC',
      adapter: new BankingGenericAdapter(),
      providerCode: 'BANKING_GENERIC',
      queryType: 'BANK_TRANSFER_VERIFICATION',
      input: { amount: 900, currency: 'BOB', reference: 'TRANSF-CONTRATO' },
      expectVerdict: 'VERIFIED',
    },
    {
      name: 'TELCO_GENERIC',
      adapter: new TelcoGenericAdapter(),
      providerCode: 'TELCO_GENERIC',
      queryType: 'PHONE_TRUST_CHECK',
      input: { phoneNumber: '70011223' },
      expectVerdict: 'VERIFIED',
    },
    {
      name: 'FACEBOOK_META',
      adapter: new FacebookMetaAdapter(),
      providerCode: 'FACEBOOK_META',
      queryType: 'SOCIAL_TRUST_CHECK',
      input: { email: 'persona@example.test' },
      expectVerdict: 'CONNECTED',
    },
    {
      name: 'WHATSAPP_GENERIC',
      adapter: new WhatsappAdapter(),
      providerCode: 'WHATSAPP_GENERIC',
      queryType: 'WHATSAPP_OTP_VERIFICATION',
      input: { phoneNumber: '70011223' },
      expectVerdict: 'OTP_VERIFIED',
    },
    {
      name: 'DIGITAL_TRUST_GENERIC',
      adapter: new DigitalTrustGenericAdapter(),
      providerCode: 'DIGITAL_TRUST_GENERIC',
      queryType: 'DIGITAL_TRUST_CHECK',
      input: { email: 'persona@example.test' },
      expectVerdict: 'COMPLETED',
    },
  ];

  it.each(providers)('$name: el emulador responde lo que su normalizador necesita', async (provider) => {
    const request = executionInput({
      providerCode: provider.providerCode,
      queryType: provider.queryType,
      input: provider.input,
      scenario: 'happy_path',
    });
    const raw = await provider.adapter.execute(request);

    expect(raw.statusCode).toBe(200);
    expect(raw.status).toBe(provider.expectVerdict);
    // El contrato se comprueba con el MISMO validador que usa el servicio de ejecución: si esto
    // pasa aquí y falla en producción, el problema es del validador, no de la prueba.
    expect(validateProviderResponse(provider.providerCode, raw.payload, raw.status)).toEqual([]);

    const observations = await provider.adapter.normalize(raw, request);
    expect(observations.length).toBeGreaterThan(0);
    for (const observation of observations) {
      expect(observation.featureKey).toBeTruthy();
      expect(observation.observationKey).toBeTruthy();
      // Ninguna observación puede salir sin valor: un `undefined` aquí es un campo que el emulador
      // dejó de mandar y que el normalizador rellenó con su default.
      const value =
        observation.valueBoolean ?? observation.valueNumber ?? observation.valueString ?? observation.valueDate ?? observation.valueJson;
      expect(value).toBeDefined();
    }
  });

  it('el journal del emulador prueba que las ocho llamadas salieron por la red', async () => {
    const evidence = await journal();
    const providersSeen = new Set(evidence.entries.filter((entry) => entry.type === 'responded').map((entry) => entry.provider));
    expect(providersSeen.size).toBeGreaterThanOrEqual(providers.length);
    // Y todas quedaron atribuidas a ESTA corrida y a ESTA persona: sin eso, la evidencia no
    // distingue una corrida de otra.
    for (const entry of evidence.entries.filter((item) => item.type === 'responded')) {
      expect(entry.runId).toBe(runId);
      expect(entry.personaKey).toBe('p-contrato');
    }
  });

  it('un escenario que el proveedor no representa NO devuelve camino feliz', async () => {
    const adapter = new SegipAdapter();
    const raw = await adapter.execute(
      executionInput({ providerCode: 'SEGIP', queryType: 'IDENTITY_VERIFICATION', scenario: 'cost_blocked' }),
    );
    // 422 del emulador, no 200 FOUND. Éste es el hallazgo H06 del paquete QA visto desde el
    // consumidor: antes esta llamada devolvía una identidad verificada.
    expect(raw.statusCode).toBe(422);
    expect(raw.status).not.toBe('FOUND');
  });

  it('una ruta que el proveedor no expone es 404, no una respuesta de negocio', async () => {
    const response = await fetch(`${base}/mock/segip/no-existe`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ input: {} }),
    });
    expect(response.status).toBe(404);
  });

  it('dos personas de la misma corrida no comparten observaciones', async () => {
    const adapter = new InfoCenterAdapter();
    const base1 = executionInput({ providerCode: 'INFOCENTER', queryType: 'CREDIT_REPORT', input: { documentNumber: '1000001' } });
    const base2 = executionInput({ providerCode: 'INFOCENTER', queryType: 'CREDIT_REPORT', input: { documentNumber: '2000002' } });
    const uno = await adapter.execute({ ...base1, qaContext: { ...base1.qaContext!, personaKey: 'p-uno' } });
    const dos = await adapter.execute({ ...base2, qaContext: { ...base2.qaContext!, personaKey: 'p-dos' } });
    expect(uno.payload.bureauScore).not.toBe(dos.payload.bureauScore);
    expect(uno.providerReference).not.toBe(dos.providerReference);
  });

  it('la misma intención con la misma clave de idempotencia no produce dos efectos', async () => {
    const adapter = new QrGenericAdapter();
    const request = executionInput({
      providerCode: 'QR_GENERIC',
      queryType: 'PAYMENT_VERIFICATION',
      input: { amount: 55, currency: 'BOB', reference: 'IDEM-BACKEND' },
      idempotencyKey: 'idem-backend-1',
    });
    const primera = await adapter.execute(request);
    const segunda = await adapter.execute(request);
    expect(segunda.payload.idempotentReplay).toBe(true);
    expect(segunda.providerReference).toBe(primera.providerReference);
  });

  it('nombrar una corrida sin su token es 401: el contexto no se fabrica desde una cabecera', async () => {
    const adapter = new SegipAdapter();
    const request = executionInput({ providerCode: 'SEGIP', queryType: 'IDENTITY_VERIFICATION' });
    const raw = await adapter.execute({ ...request, qaContext: { tenantId, runId, runToken: 'token-inventado' } });
    expect(raw.statusCode).toBe(401);
  });

  it('sin contexto de corrida el backend sigue funcionando: es el consumidor actual', async () => {
    const adapter = new SegipAdapter();
    const request = executionInput({ providerCode: 'SEGIP', queryType: 'IDENTITY_VERIFICATION' });
    const raw = await adapter.execute({ ...request, qaContext: undefined });
    expect(raw.statusCode).toBe(200);
    expect(raw.status).toBe('FOUND');
  });
});
