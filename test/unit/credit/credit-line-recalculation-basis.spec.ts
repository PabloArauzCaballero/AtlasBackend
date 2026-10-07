/**
 * @file P-09/P-10 — el recálculo de línea registra la base habilitante ANTES de preguntar al motor.
 * @business Antes la base se registraba después de la primera decisión y el motor, sin base, ya no
 *   decide: la línea del cliente nuevo nunca se calculaba. Si la base no llega, la línea no se toca.
 * @system `CreditLineRecalculationService.recalculate` con el cliente del motor y el expediente dobles.
 */
import { describe, expect, it, jest } from '@jest/globals';
import { CreditLineRecalculationService } from '../../../src/modules/credit/application/credit-line-recalculation.service.js';
import { DecisionEngineClient } from '../../../src/modules/decision-engine/decision-engine.client.js';

type Productos = () => Promise<Array<{ annualInterestRate: unknown }>>;

function build(
  readiness: { status: 'ready' | 'pending' | 'superseded' | 'revoked'; marker: string | null },
  productos: Productos = async () => [{ annualInterestRate: '22.0000' }, { annualInterestRate: '18.0000' }],
) {
  const order: string[] = [];
  const client = {
    isConfigured: true,
    ensureUnderwritingBasis: jest.fn(async (..._args: unknown[]) => {
      order.push('basis');
      return readiness;
    }),
    execute: jest.fn(async (..._args: unknown[]) => {
      order.push('decide');
      return { executionId: 'e1', status: 'SUCCEEDED', outcome: 'APPROVE', reasonCodes: [], output: { approved_credit_limit: 900 } };
    }),
  };
  const features = {
    build: async () => ({
      variables: { declared_monthly_income: 3000 },
      provenance: { declared_monthly_income: 'expediente' },
      variableMetadata: { requested_amount: { observedAt: '2026-09-24T12:00:00.000Z' } },
      observedAt: { economy: new Date('2026-08-01T00:00:00.000Z'), identity: null },
    }),
  };
  const capacity = {
    assess: async () => ({
      recommendedLimit: 900,
      monthlyInstallment: 300,
      bindingConstraint: 'CAPACIDAD',
      evidence: 'DECLARADO',
      relationshipScore: 10,
      relationshipTier: 'NUEVO',
      components: { tenure: 0, paymentHistory: 0, loyalty: 0, verification: 0 },
    }),
  };
  const escritor = { lineaVigente: async () => null, persist: jest.fn(async (..._args: unknown[]) => ({ id: 'line-1' })) };
  const service = new CreditLineRecalculationService(
    {} as never,
    { resolve: async () => ({ artifactCode: 'BNPL' }) } as never,
    features as never,
    client as never,
    { register: async () => 'subj-1' } as never,
    capacity as never,
    {} as never,
    escritor as never,
    { findOfferableProducts: productos } as never,
  );
  return { service, client, escritor, order };
}

const input = { tenantId: '1', customerId: '24', trigger: 'onboarding' as const };

describe('P-09 · recálculo de línea: base habilitante antes de decidir', () => {
  it('registra la base y SÓLO después pregunta al motor, con las fechas de cada dato', async () => {
    const { service, client, escritor, order } = build({ status: 'ready', marker: '1' });
    await service.recalculate(input);

    expect(order).toEqual(['basis', 'decide']);
    expect(client.ensureUnderwritingBasis).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: '1', customerId: '24', subjectReference: 'subj-1' }),
    );
    const [[, request]] = client.execute.mock.calls as unknown as [[string, { variableMetadata: Record<string, unknown> }]];
    expect(request.variableMetadata).toMatchObject({
      requested_amount: { observedAt: '2026-09-24T12:00:00.000Z' },
      capacity_recommended_limit: { observedAt: '2026-08-01T00:00:00.000Z' },
    });
    expect(escritor.persist).toHaveBeenCalled();
  });

  it.each(['pending', 'revoked'] as const)('base %s: no pregunta al motor y no toca la línea', async (status) => {
    const { service, client, escritor } = build({ status, marker: null });
    await expect(service.recalculate(input)).resolves.toBeNull();
    expect(client.execute).not.toHaveBeenCalled();
    expect(escritor.persist).not.toHaveBeenCalled();
  });

  it('manda la tasa base del producto ofertable más barato, en tanto por uno y fechada al pedir', async () => {
    const { service, client } = build({ status: 'ready', marker: '1' });
    await service.recalculate(input);
    const [[, request]] = client.execute.mock.calls as unknown as [
      [string, { variables: Record<string, unknown>; context: { provenance: Record<string, unknown> } }],
    ];
    expect(request.variables.product_base_annual_rate).toBeCloseTo(0.18, 9);
    expect(request.context.provenance.product_base_annual_rate).toBe('derivado');
  });

  it.each([
    ['sin productos ofertables', async () => []],
    ['si la consulta del catálogo falla', async () => Promise.reject(new Error('caída'))],
  ] as Array<[string, Productos]>)('%s manda 0 y sigue decidiendo', async (_caso, productos) => {
    const { service, client, escritor } = build({ status: 'ready', marker: '1' }, productos);
    await service.recalculate(input);
    const [[, request]] = client.execute.mock.calls as unknown as [[string, { variables: Record<string, unknown> }]];
    expect(request.variables.product_base_annual_rate).toBe(0);
    expect(escritor.persist).toHaveBeenCalled();
  });

  it('la regla de bloqueo del cliente es la del módulo del motor', () => {
    expect(DecisionEngineClient.basisBlocker({ status: 'superseded', marker: 's1' })).toBeNull();
  });
});

/**
 * El crédito habilitado que ve la app es el que DECIDIÓ el motor (plan 2026-10-06, H1.S1.M2), en tres niveles:
 * el monto del motor se escribe tal cual con su ejecución; un monto 0 es una decisión y no se rellena; y un motor
 * caído no escribe nada (la línea vigente queda como estaba).
 */
describe('H1.S1.M2 · el monto de la línea es el del motor', () => {
  const persistido = (escritor: ReturnType<typeof build>['escritor']) => JSON.stringify((escritor.persist.mock.calls as unknown[][])[0]);

  it('correcto: escribe el límite que devolvió el motor, con su ejecución', async () => {
    const { service, escritor } = build({ status: 'ready', marker: '1' });
    await service.recalculate(input);
    const escrito = persistido(escritor);
    expect(escrito).toContain('"approvedLimit":900,');
    expect(escrito).toContain('e1');
  });

  it('límite: un monto 0 del motor se respeta, no se sustituye por la capacidad', async () => {
    const { service, client, escritor } = build({ status: 'ready', marker: '1' });
    client.execute.mockResolvedValueOnce({
      executionId: 'e0',
      status: 'SUCCEEDED',
      outcome: 'DECLINE',
      reasonCodes: [],
      output: { approved_credit_limit: 0 },
    } as never);
    await service.recalculate(input);
    const escrito = persistido(escritor);
    expect(escrito).toContain('e0');
    expect(escrito).toContain('"approvedLimit":0,');
  });

  it('inválido: si el motor falla, no escribe ninguna línea', async () => {
    const { service, client, escritor } = build({ status: 'ready', marker: '1' });
    client.execute.mockRejectedValueOnce(new Error('motor caído') as never);
    await expect(service.recalculate(input)).resolves.toBeNull();
    expect(escritor.persist).not.toHaveBeenCalled();
  });
});
