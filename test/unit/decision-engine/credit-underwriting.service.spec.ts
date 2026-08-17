import { describe, expect, it, jest } from '@jest/globals';
import { CreditUnderwritingService } from '../../../src/modules/credit/application/credit-underwriting.service.js';
import type { DecisionOutcome, DecisionResponse } from '../../../src/modules/decision-engine/decision-engine.types.js';

/**
 * Aplicación de la decisión del motor al expediente.
 *
 * La propiedad que fijan estas pruebas es la que separa una integración defendible de una
 * peligrosa: **un motor caído deriva a revisión, nunca rechaza**. Confundir las dos cosas negaría
 * crédito a gente que cumplía por una avería de infraestructura, y además contaminaría el
 * monitoreo con una cartera de rechazos que ninguna versión del artefacto llegó a emitir.
 */
describe('CreditUnderwritingService', () => {
  function response(overrides: Partial<DecisionResponse> = {}): DecisionResponse {
    return {
      executionId: '88001',
      status: 'COMPLETED',
      outcome: 'APPROVE',
      reasonCodes: [],
      artifact: { versionId: '4001' },
      ...overrides,
    } as DecisionResponse;
  }

  function build(outcome: DecisionOutcome) {
    const application: Record<string, unknown> = { id: 'app-1', status: 'submitted', save: jest.fn() };
    const engine = {
      decide: jest.fn(async (..._args: unknown[]) => ({
        outcome,
        subjectReference: 'hash-del-sujeto',
        excludedFeatures: [{ featureCode: 'edad', reason: 'NOT_ALLOWED_FOR_CREDIT_DECISION' }],
      })),
    };
    const credit = {
      findApplicationById: jest.fn(async (..._args: unknown[]): Promise<Record<string, unknown> | null> => application),
      createApplicationEvent: jest.fn(async (..._args: unknown[]) => ({})),
    };
    const sequelize = { transaction: jest.fn(async (cb: (t: unknown) => Promise<unknown>) => cb({})) };
    const service = new CreditUnderwritingService(engine as never, credit as never, sequelize as never);
    return { service, application, credit, engine };
  }

  const input = {
    tenantId: '1',
    applicationId: 'app-1',
    customerId: 'c1',
    applicationCode: 'CRA-1',
    requestedAmount: '5000.00',
    requestedTermMonths: 12,
    currencyCode: 'BOB',
    productCode: 'consumo_30',
    purposeCode: null,
  };

  it('aprueba cuando el motor aprueba, y guarda la ejecución que lo decidió', async () => {
    const { service, application } = build({ kind: 'approved', response: response() });
    const result = await service.underwrite(input);

    expect(result.status).toBe('approved');
    expect(result.decisionMode).toBe('decision_engine');
    expect(application.decisionExecutionId).toBe('88001');
    expect(application.decisionArtifactVersionId).toBe('4001');
    expect(application.decisionSubjectReference).toBe('hash-del-sujeto');
  });

  it('rechaza cuando la política rechaza, conservando sus motivos', async () => {
    const declined = response({
      outcome: 'DECLINE',
      reasonCodes: [{ code: 'INSUFFICIENT_INCOME', adverseAction: true }],
    });
    const { service } = build({ kind: 'declined', response: declined });
    const result = await service.underwrite(input);

    expect(result.status).toBe('rejected');
    expect(result.reasonCodes).toEqual(['INSUFFICIENT_INCOME']);
  });

  it('DERIVA A REVISIÓN cuando el motor no responde: no rechaza', async () => {
    const { service, application } = build({ kind: 'engineUnavailable', reason: 'ECONNREFUSED' });
    const result = await service.underwrite(input);

    expect(result.status).toBe('under_review');
    expect(result.decisionMode).toBe('engine_unavailable_manual');
    expect(result.executionId).toBeNull();
    // Sin ejecución no hay nada que atribuir: la solicitud no puede quedar contada como decidida.
    expect(application.decisionExecutionId).toBeNull();
  });

  it('deriva a revisión un desenlace que el core no sabe leer, en vez de aprobarlo', async () => {
    // Un artefacto puede publicar mañana APPROVE_WITH_CONDITIONS. Tratarlo como aprobación por no
    // reconocerlo concedería un crédito en condiciones que nadie ha implementado.
    const { service } = build({ kind: 'review', response: response({ outcome: 'APPROVE_WITH_CONDITIONS' }) });
    const result = await service.underwrite(input);

    expect(result.status).toBe('under_review');
    expect(result.decisionMode).toBe('decision_engine');
  });

  it('registra en el historial las features que el catálogo prohibía usar', async () => {
    const { service, credit } = build({ kind: 'approved', response: response() });
    await service.underwrite(input);

    const [[event]] = credit.createApplicationEvent.mock.calls as unknown as [[Record<string, never>]];
    const payload = (event as unknown as { payloadJson: { excludedFeatures: unknown[] } }).payloadJson;
    // Quien audite la decisión tiene que poder distinguir «no había dato» de «había y no se podía usar».
    expect(payload.excludedFeatures).toEqual([{ featureCode: 'edad', reason: 'NOT_ALLOWED_FOR_CREDIT_DECISION' }]);
  });

  it('no explota si la solicitud desapareció entre la llamada al motor y la escritura', async () => {
    const { service, credit } = build({ kind: 'approved', response: response() });
    credit.findApplicationById = jest.fn(async (..._args: unknown[]): Promise<Record<string, unknown> | null> => null);
    await expect(service.underwrite(input)).resolves.toEqual({
      status: 'unknown',
      decisionMode: null,
      executionId: null,
      reasonCodes: [],
    });
  });
});
