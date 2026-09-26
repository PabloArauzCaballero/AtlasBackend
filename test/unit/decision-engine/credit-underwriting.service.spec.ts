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
      // Frente 3A: `decideWithProduct` lo consulta ANTES de llamar al motor, para mandarle la tasa
      // base del producto. `null` es una respuesta válida (producto sin resolver -> tasa base 0).
      findProductByCode: jest.fn(async (..._args: unknown[]): Promise<Record<string, unknown> | null> => ({ annualInterestRate: null })),
    };
    // El caso PROPIO de Atlas (C-1): sólo se abre cuando el Motor no abrió el suyo.
    const reviewCases = { open: jest.fn(async (..._args: unknown[]) => ({ caseCode: 'CR-CRA-1' })) };
    const sequelize = {
      transaction: jest.fn(async (cb: (t: unknown) => Promise<unknown>) => cb({})),
      // `nextCreditApplicationVersion` (T-11): sin outbox previo, el máximo es null -> versión 1.
      query: jest.fn(async (..._args: unknown[]) => [{ version: null }]),
    };
    const events = { publish: jest.fn(async (..._args: unknown[]) => undefined) };
    const service = new CreditUnderwritingService(
      engine as never,
      credit as never,
      sequelize as never,
      reviewCases as never,
      events as never,
    );
    return { service, application, credit, engine, reviewCases, events, sequelize };
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

  it('T-11: aprobada CON banda de riesgo publica credit.decision.recorded para el ERP', async () => {
    const { service, events } = build({ kind: 'approved', response: response({ riskBand: 'B' }) });
    await service.underwrite(input);

    expect(events.publish).toHaveBeenCalledTimes(1);
    const [envelope] = (events.publish as jest.Mock).mock.calls[0] as [Record<string, unknown>];
    expect(envelope).toMatchObject({
      eventCode: 'credit.decision.recorded',
      aggregateType: 'credit_application',
      aggregateId: 'app-1',
      aggregateVersion: 1,
      payload: { customerId: 'c1', riskBand: 'B', applicationCode: 'CRA-1' },
    });
  });

  it('T-11: aprobada SIN banda de riesgo no publica nada (nunca inventa una banda)', async () => {
    const { service, events } = build({ kind: 'approved', response: response({ riskBand: null }) });
    await service.underwrite(input);

    expect(events.publish).not.toHaveBeenCalled();
  });

  it('T-11: rechazada no publica credit.decision.recorded (sólo una aprobación fija tarifa)', async () => {
    const declined = response({ outcome: 'DECLINE', reasonCodes: [{ code: 'INSUFFICIENT_INCOME', adverseAction: true }] });
    const { service, events } = build({ kind: 'declined', response: declined });
    await service.underwrite(input);

    expect(events.publish).not.toHaveBeenCalled();
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
    // Y el motivo queda escrito (C-2): una solicitud en revisión sin motivo no dice si espera a una
    // persona por política o por una avería.
    expect(application.decisionReasonCode).toBe('engine_unavailable');
    expect(result.reasonCodes).toEqual(['engine_unavailable']);
  });

  it('deriva a revisión un desenlace que el core no sabe leer, en vez de aprobarlo', async () => {
    // Un artefacto puede publicar mañana APPROVE_WITH_CONDITIONS. Tratarlo como aprobación por no
    // reconocerlo concedería un crédito en condiciones que nadie ha implementado.
    const { service } = build({ kind: 'review', response: response({ outcome: 'APPROVE_WITH_CONDITIONS' }) });
    const result = await service.underwrite(input);

    expect(result.status).toBe('under_review');
    // Sin caso abierto en el motor no hay bandeja allí: la revisión es de Atlas. Con
    // `decision_engine` la solicitud quedaba sin nadie que pudiera resolverla (P-10).
    expect(result.decisionMode).toBe('engine_unavailable_manual');
  });

  it('deja escrito en el historial el caso que el Motor abrió: es lo que dice dónde se resuelve', async () => {
    const { service, credit } = build({
      kind: 'review',
      response: response({
        outcome: 'MANUAL_REVIEW',
        manualReview: { caseCode: 'MRC-000088001', queueCode: 'CREDIT_REVIEW', priority: 50 },
      }),
    });
    await service.underwrite(input);

    const [[event]] = credit.createApplicationEvent.mock.calls as unknown as [[Record<string, Record<string, unknown>>]];
    expect(event.payloadJson).toMatchObject({ manualReviewCaseCode: 'MRC-000088001', manualReviewQueueCode: 'CREDIT_REVIEW' });
  });

  it('sin caso en el Motor el historial lo dice con null, no lo omite', async () => {
    const { service, credit } = build({ kind: 'declined', response: response({ outcome: 'DECLINE' }) });
    await service.underwrite(input);
    const [[event]] = credit.createApplicationEvent.mock.calls as unknown as [[Record<string, Record<string, unknown>>]];
    expect(event.payloadJson).toMatchObject({ manualReviewCaseCode: null });
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

  /*
   * C-1 (2026-09-25): una solicitud en `under_review` tiene que tener una bandeja. Si el Motor abrió
   * su caso, esa es; si NO lo abrió —un `review` sin `manualReview.caseCode`, o un motor que no
   * respondió—, Atlas abre el suyo. Antes la solicitud quedaba sin bandeja en ningún sitio.
   */
  describe('la revisión siempre queda en una bandeja (C-1)', () => {
    it('un review del Motor SIN caso abre el caso PROPIO de Atlas y lo registra en la solicitud', async () => {
      const { service, application, reviewCases, credit } = build({
        kind: 'review',
        response: response({ outcome: 'MANUAL_REVIEW', manualReview: null }),
      });

      const result = await service.underwrite(input);

      expect(result.status).toBe('under_review');
      expect(reviewCases.open).toHaveBeenCalledWith(
        expect.objectContaining({ tenantId: '1', customerId: 'c1', applicationCode: 'CRA-1' }),
        expect.anything(),
      );
      expect(application.manualReviewCaseCode).toBe('CR-CRA-1');
      expect(application.manualReviewCaseSource).toBe('atlas');
      const [[event]] = credit.createApplicationEvent.mock.calls as unknown as [[Record<string, Record<string, unknown>>]];
      expect(event.payloadJson).toMatchObject({ manualReviewCaseCode: 'CR-CRA-1', manualReviewCaseSource: 'atlas' });
    });

    it('un review del Motor CON caso registra el del Motor y NO abre uno propio', async () => {
      const { service, application, reviewCases } = build({
        kind: 'review',
        response: response({ outcome: 'MANUAL_REVIEW', manualReview: { caseCode: 'MRC-000088001', queueCode: 'CREDIT_REVIEW' } }),
      });

      await service.underwrite(input);

      expect(reviewCases.open).not.toHaveBeenCalled();
      expect(application.manualReviewCaseCode).toBe('MRC-000088001');
      expect(application.manualReviewCaseSource).toBe('engine');
    });

    it('un motor que no respondió también deja la solicitud en una bandeja de Atlas', async () => {
      const { service, application, reviewCases } = build({ kind: 'engineUnavailable', reason: 'ECONNREFUSED' });

      await service.underwrite(input);

      expect(reviewCases.open).toHaveBeenCalledTimes(1);
      expect(application.manualReviewCaseSource).toBe('atlas');
      expect(application.manualReviewCaseCode).toBe('CR-CRA-1');
    });

    it('lo que se aprueba o se rechaza no espera a nadie: no abre caso ni lo registra', async () => {
      for (const outcome of [
        { kind: 'approved', response: response() },
        { kind: 'declined', response: response({ outcome: 'DECLINE' }) },
      ] as DecisionOutcome[]) {
        const { service, application, reviewCases } = build(outcome);
        await service.underwrite(input);
        expect(reviewCases.open).not.toHaveBeenCalled();
        expect(application.manualReviewCaseCode).toBeNull();
        expect(application.manualReviewCaseSource).toBeNull();
      }
    });
  });

  /*
   * Frente 3A (plan `_plan-motor-decisiones-tasa-2026-09-25`, punto 4): lo que el Motor tarificó
   * para ESTA ejecución se persiste en la solicitud, en las MISMAS unidades que usa el resto del
   * libro (porcentaje) — nunca en tanto por uno, que es como lo publica el Motor.
   */
  describe('la tasa y el tramo que decidió el Motor se persisten (Frente 3A)', () => {
    it('0,18 en la respuesta del Motor se guarda como 18.0000 (PORCENTAJE), no como 0.18', async () => {
      const { service, application } = build({
        kind: 'approved',
        response: response({ output: { annual_percentage_rate: 0.18, pricing_tier: 'B' } }),
      });

      await service.underwrite(input);

      expect(application.decisionPricedRate).toBe('18.0000');
      expect(application.decisionPricingTier).toBe('B');
    });

    it('PRUEBA EN NEGATIVO — sin `annual_percentage_rate` en la respuesta, se guarda null, nunca 0 ni NaN', async () => {
      const { service, application } = build({ kind: 'approved', response: response({ output: { pricing_tier: 'A' } }) });

      await service.underwrite(input);

      expect(application.decisionPricedRate).toBeNull();
      // El tramo SÍ puede venir sin la tasa (p. ej. un artefacto v1): se guarda igual.
      expect(application.decisionPricingTier).toBe('A');
    });

    it('PRUEBA EN NEGATIVO — sin `output` en absoluto (artefacto anterior a v2), las dos columnas quedan null', async () => {
      const { service, application } = build({ kind: 'approved', response: response() });

      await service.underwrite(input);

      expect(application.decisionPricedRate).toBeNull();
      expect(application.decisionPricingTier).toBeNull();
    });

    it('la tasa y el tramo también quedan en el evento de la decisión, para auditar sin reconstruir la respuesta del motor', async () => {
      const { service, credit } = build({
        kind: 'approved',
        response: response({ output: { annual_percentage_rate: 0.145, pricing_tier: 'C' } }),
      });

      await service.underwrite(input);

      const [[event]] = credit.createApplicationEvent.mock.calls as unknown as [[Record<string, Record<string, unknown>>]];
      expect(event.payloadJson).toMatchObject({ decisionPricedRate: '14.5000', decisionPricingTier: 'C' });
    });

    it('un motor caído no puede haber tarificado nada: las dos columnas quedan null, no heredan un valor de antes', async () => {
      const { service, application } = build({ kind: 'engineUnavailable', reason: 'ECONNREFUSED' });

      await service.underwrite(input);

      expect(application.decisionPricedRate).toBeNull();
      expect(application.decisionPricingTier).toBeNull();
    });
  });

  /*
   * El barrido de solicitudes atascadas vuelve a llamar a `underwrite`, y la petición original puede
   * seguir viva: la solicitud que ya salió de `submitted` no se pisa (C-2).
   */
  it('no pisa una solicitud que ya no está submitted: dos caminos pueden llegar aquí', async () => {
    const { service, application, credit, reviewCases } = build({ kind: 'declined', response: response({ outcome: 'DECLINE' }) });
    Object.assign(application, { status: 'approved', decisionMode: 'decision_engine', decisionExecutionId: '77' });

    const result = await service.underwrite(input);

    expect(result).toEqual({ status: 'approved', decisionMode: 'decision_engine', executionId: '77', reasonCodes: [] });
    expect(application.save).not.toHaveBeenCalled();
    expect(credit.createApplicationEvent).not.toHaveBeenCalled();
    expect(reviewCases.open).not.toHaveBeenCalled();
  });
});
