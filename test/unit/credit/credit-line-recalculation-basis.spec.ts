/**
 * @file P-09/P-10 — el recálculo de línea registra la base habilitante ANTES de preguntar al motor.
 * @business Antes la base se registraba después de la primera decisión y el motor, sin base, ya no
 *   decide: la línea del cliente nuevo nunca se calculaba. Si la base no llega, la línea no se toca.
 * @system `CreditLineRecalculationService.recalculate` con el cliente del motor y el expediente dobles.
 */
import { describe, expect, it, jest } from '@jest/globals';
import { CreditLineRecalculationService } from '../../../src/modules/credit/application/credit-line-recalculation.service.js';
import { DecisionEngineClient } from '../../../src/modules/decision-engine/decision-engine.client.js';

function build(readiness: { status: 'ready' | 'pending' | 'superseded' | 'revoked'; marker: string | null }) {
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

  it('la regla de bloqueo del cliente es la del módulo del motor', () => {
    expect(DecisionEngineClient.basisBlocker({ status: 'superseded', marker: 's1' })).toBeNull();
  });
});
