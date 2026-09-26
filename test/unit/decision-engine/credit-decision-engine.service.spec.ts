/**
 * @file Verifica que ninguna avería previa a la llamada al motor deje una solicitud colgada en `submitted`.
 * @business Una solicitud creada y nunca decidida bloquea al cliente para siempre; tiene que pasar a revisión con su motivo.
 * @system Ejercita `CreditDecisionEngineService.decide` (C-2) y su encadenamiento con `CreditUnderwritingService`.
 */
import { describe, expect, it, jest } from '@jest/globals';
import { CreditDecisionEngineService } from '../../../src/modules/decision-engine/credit-decision-engine.service.js';
import { CreditUnderwritingService } from '../../../src/modules/credit/application/credit-underwriting.service.js';

const request = {
  tenantId: '1',
  customerId: 'c1',
  applicationId: 'app-1',
  applicationCode: 'CRA-1',
  requestedAmount: '5000.00',
  requestedTermMonths: 12,
  currencyCode: 'BOB',
  productCode: 'consumo_30',
  purposeCode: null,
};

const engineResponse = {
  executionId: '88001',
  status: 'COMPLETED',
  outcome: 'APPROVE',
  reasonCodes: [],
  artifact: { versionId: '4001' },
};

function build(overrides: { failAt?: 'subjects' | 'features' | 'underwriting' | 'client' } = {}) {
  const tracing = {
    runInSpan: jest.fn(async (_name: string, _attrs: unknown, fn: (span: unknown) => Promise<unknown>) =>
      fn({ setAttribute: jest.fn(), addEvent: jest.fn() }),
    ),
  };
  const client = {
    isConfigured: true,
    // La base habilitante (P-09) se comprueba ANTES de proyectar features; por defecto está lista,
    // para que estos casos sigan probando lo suyo (una avería EN una etapa posterior) y no la base.
    consents: {
      ensureGranted: jest.fn(async (..._args: unknown[]) => ({ status: 'ready' as const })),
    },
    execute: jest.fn(async (..._args: unknown[]): Promise<unknown> => {
      if (overrides.failAt === 'client') throw new Error('ECONNREFUSED');
      return engineResponse;
    }),
  };
  const features = {
    projectForCustomer: jest.fn(async (..._args: unknown[]) => {
      if (overrides.failAt === 'features') throw new Error('timeout de la consulta');
      return { variables: {}, lineage: [], excluded: [{ featureCode: 'edad', reason: 'NOT_ALLOWED_FOR_CREDIT_DECISION' }] };
    }),
  };
  const underwriting = {
    build: jest.fn(async (..._args: unknown[]) => {
      if (overrides.failAt === 'underwriting') throw new Error('columna inexistente');
      return { variables: { kyc_status: 'VERIFIED' }, provenance: {} };
    }),
  };
  const subjects = {
    register: jest.fn(async (..._args: unknown[]) => {
      if (overrides.failAt === 'subjects') throw new Error('DECISION_ENGINE_SUBJECT_SALT no está configurada.');
      return 'hash-del-sujeto';
    }),
  };
  const bindings = { resolve: jest.fn(async (..._args: unknown[]) => ({ artifactCode: 'ATLAS_BNPL_UNDERWRITING' })) };
  const service = new CreditDecisionEngineService(
    tracing as never,
    client as never,
    features as never,
    underwriting as never,
    subjects as never,
    bindings as never,
  );
  return { service, client, features, underwriting, subjects };
}

describe('CreditDecisionEngineService · nunca lanza por un fallo previo a la llamada (C-2)', () => {
  it.each([
    ['subjects', 'SUBJECT_REGISTRATION_FAILED', 'DECISION_ENGINE_SUBJECT_SALT'],
    ['features', 'FEATURE_PROJECTION_FAILED', 'timeout de la consulta'],
    ['underwriting', 'UNDERWRITING_INPUTS_FAILED', 'columna inexistente'],
  ] as const)('si falla %s, devuelve engineUnavailable rotulado y no llama al motor', async (failAt, stage, message) => {
    const { service, client } = build({ failAt });

    // Antes estas tres llamadas corrían FUERA del try: la excepción cruzaba el servicio, el submit
    // respondía 500 tras el commit y la solicitud quedaba `submitted` para siempre.
    const result = await service.decide(request);

    expect(result.outcome).toMatchObject({ kind: 'engineUnavailable' });
    expect((result.outcome as { reason: string }).reason).toContain(stage);
    expect((result.outcome as { reason: string }).reason).toContain(message);
    expect(client.execute).not.toHaveBeenCalled();
  });

  it('un fallo de la llamada al motor conserva su motivo tal cual (es lo que ya leía el monitoreo)', async () => {
    const { service } = build({ failAt: 'client' });

    const result = await service.decide(request);

    expect(result.outcome).toEqual({ kind: 'engineUnavailable', reason: 'ECONNREFUSED' });
  });

  it('conserva la referencia del sujeto y las features excluidas cuando el fallo llega después de obtenerlas', async () => {
    const { service } = build({ failAt: 'client' });

    const result = await service.decide(request);

    expect(result.subjectReference).toBe('hash-del-sujeto');
    expect(result.excludedFeatures).toEqual([{ featureCode: 'edad', reason: 'NOT_ALLOWED_FOR_CREDIT_DECISION' }]);
  });

  it('el camino feliz sigue decidiendo con el motor', async () => {
    const { service, client } = build();

    const result = await service.decide(request);

    expect(result.outcome).toMatchObject({ kind: 'approved' });
    expect(client.execute).toHaveBeenCalledTimes(1);
  });
});

describe('C-2 de punta a punta · la solicitud NO queda submitted si el registro del sujeto falla', () => {
  function buildUnderwriting(engine: CreditDecisionEngineService) {
    const application: Record<string, unknown> = {
      id: 'app-1',
      status: 'submitted',
      decisionReasonCode: null,
      save: jest.fn(async (..._args: unknown[]) => undefined),
    };
    const credit = {
      findApplicationById: jest.fn(async (..._args: unknown[]): Promise<Record<string, unknown> | null> => application),
      createApplicationEvent: jest.fn(async (..._args: unknown[]) => ({})),
    };
    const reviewCases = { open: jest.fn(async (..._args: unknown[]) => ({ caseCode: 'CR-CRA-1' })) };
    const sequelize = { transaction: jest.fn(async (cb: (t: unknown) => Promise<unknown>) => cb({})) };
    const underwritingService = new CreditUnderwritingService(
      engine as never,
      credit as never,
      sequelize as never,
      reviewCases as never,
      {} as never,
    );
    return { underwritingService, application, credit, reviewCases };
  }

  const input = { ...request, customerId: 'c1', productCode: 'consumo_30', purposeCode: null };

  it('queda en revisión con motivo registrado y con caso, no colgada', async () => {
    const { service } = build({ failAt: 'subjects' });
    const { underwritingService, application, credit, reviewCases } = buildUnderwriting(service);

    const result = await underwritingService.underwrite(input);

    expect(application.status).not.toBe('submitted');
    expect(application.status).toBe('under_review');
    expect(application.decisionMode).toBe('engine_unavailable_manual');
    expect(application.decisionReasonCode).toBe('engine_unavailable');
    expect(result).toMatchObject({
      status: 'under_review',
      decisionMode: 'engine_unavailable_manual',
      reasonCodes: ['engine_unavailable'],
    });
    // El motivo técnico queda en el historial, para quien tenga que mirar por qué.
    const [[event]] = credit.createApplicationEvent.mock.calls as unknown as [[Record<string, unknown>]];
    expect(event.notes).toContain('SUBJECT_REGISTRATION_FAILED');
    // Y hay quién la mire: sin caso, «en revisión» era otro callejón.
    expect(reviewCases.open).toHaveBeenCalledTimes(1);
    expect(application.manualReviewCaseSource).toBe('atlas');
  });
});
