/**
 * @file Verifica que una solicitud de crédito en revisión siempre tenga una bandeja y una salida.
 * @business Un `review` del Motor sin caso propio no puede dejar la solicitud sin resolver en ningún sitio.
 * @system Ejercita `CreditDecisionService.decide` (C-1, C-3) y `CreditReviewCaseRepository` (caso propio de Atlas).
 */
import { describe, expect, it, jest } from '@jest/globals';
import { ConflictException } from '@nestjs/common';
import { CreditDecisionService } from '../../../src/modules/credit/application/credit-decision.service.js';
import { CreditReviewCaseRepository } from '../../../src/modules/credit/credit-review-case.repository.js';
import { CreditUnderwritingService } from '../../../src/modules/credit/application/credit-underwriting.service.js';

const operador = { sub: 'operator-3', tenantId: '7', internalUserId: '3', role: 'admin' } as never;

type App = Record<string, unknown>;

function build(application: App | null) {
  const transaction = { id: 'tx' };
  const creditRepository = {
    findApplicationById: jest.fn(async (..._args: unknown[]) => application),
    updateApplicationStatus: jest.fn(async (...args: unknown[]) => {
      const [app, values] = args as [App, Record<string, unknown>];
      Object.assign(app, { status: values.status, ...(values.decisionMode !== undefined ? { decisionMode: values.decisionMode } : {}) });
      return app;
    }),
    createApplicationEvent: jest.fn(async (..._args: unknown[]) => undefined),
  };
  const reviewCases = { close: jest.fn(async (..._args: unknown[]) => true) };
  const sequelize = { transaction: jest.fn(async (cb: (t: unknown) => Promise<unknown>) => cb(transaction)) };
  const service = new CreditDecisionService(creditRepository as never, sequelize as never, reviewCases as never);
  return { service, creditRepository, reviewCases, transaction };
}

/** El Motor respondió `review` y NO abrió caso: Atlas abrió el suyo (`source = atlas`). */
const revisionSinCasoDelMotor = (overrides: App = {}): App => ({
  id: '41',
  applicationCode: 'CRA-41',
  status: 'under_review',
  decisionMode: 'decision_engine',
  decisionExecutionId: '9101',
  manualReviewCaseCode: 'CR-CRA-41',
  manualReviewCaseSource: 'atlas',
  ...overrides,
});

describe('C-1 · un review del Motor sin caso propio no deja la solicitud sin salida', () => {
  it('la decisión humana resuelve la solicitud SIN 409 aunque el Motor la haya ejecutado', async () => {
    const { service, creditRepository } = build(revisionSinCasoDelMotor());

    // Antes: `decisionExecutionId && decisionMode === 'decision_engine'` bastaba para el 409, y como
    // el Motor no abrió bandeja, la solicitud quedaba en `under_review` sin nadie que la resolviera.
    await expect(
      service.decide({ tenantId: '7', applicationId: '41', currentUser: operador, body: { decision: 'approve', reasonCode: 'ok' } }),
    ).resolves.toMatchObject({ status: 'approved', previousStatus: 'under_review' });
    expect(creditRepository.updateApplicationStatus).toHaveBeenCalledTimes(1);
  });

  it('cierra el caso propio de Atlas con la resolución de la persona', async () => {
    const { service, reviewCases, transaction } = build(revisionSinCasoDelMotor());

    await service.decide({
      tenantId: '7',
      applicationId: '41',
      currentUser: operador,
      body: { decision: 'reject', reasonCode: 'ingreso_insuficiente', notes: 'No alcanza' },
    });

    expect(reviewCases.close).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: '7', caseCode: 'CR-CRA-41', resolution: 'reject', notes: 'No alcanza' }),
      { transaction },
    );
  });

  it('pedir más información deja la solicitud abierta y por eso deja también el caso', async () => {
    const { service, reviewCases } = build(revisionSinCasoDelMotor());

    await service.decide({
      tenantId: '7',
      applicationId: '41',
      currentUser: operador,
      body: { decision: 'request_more_information', reasonCode: 'falta_extracto', notes: 'Suba el extracto' },
    });

    expect(reviewCases.close).not.toHaveBeenCalled();
  });

  it('SIGUE rechazando con 409 cuando el Motor SÍ abrió su caso: allí está la bandeja buena', async () => {
    const { service, creditRepository, reviewCases } = build(
      revisionSinCasoDelMotor({ manualReviewCaseCode: 'MRC-9101', manualReviewCaseSource: 'engine' }),
    );

    const attempt = service.decide({
      tenantId: '7',
      applicationId: '41',
      currentUser: operador,
      body: { decision: 'approve', reasonCode: 'ok' },
    });

    await expect(attempt).rejects.toBeInstanceOf(ConflictException);
    await expect(attempt).rejects.toThrow(/CREDIT_DECISION_DELEGADA_AL_MOTOR/);
    expect(creditRepository.updateApplicationStatus).not.toHaveBeenCalled();
    expect(reviewCases.close).not.toHaveBeenCalled();
  });

  it('una solicitud anterior a C-1 (sin registro de quién abrió caso) conserva el corte de siempre', async () => {
    const { service } = build(revisionSinCasoDelMotor({ manualReviewCaseCode: null, manualReviewCaseSource: null }));

    await expect(
      service.decide({ tenantId: '7', applicationId: '41', currentUser: operador, body: { decision: 'approve', reasonCode: 'ok' } }),
    ).rejects.toThrow(/CREDIT_DECISION_DELEGADA_AL_MOTOR/);
  });

  it('decidir no depende de que el caso exista: una solicitud sin caso registrado se resuelve igual', async () => {
    const { service, reviewCases } = build({
      id: '42',
      status: 'under_review',
      decisionMode: 'manual',
      decisionExecutionId: null,
      manualReviewCaseCode: null,
      manualReviewCaseSource: null,
    });

    await expect(
      service.decide({ tenantId: '7', applicationId: '42', currentUser: operador, body: { decision: 'approve', reasonCode: 'ok' } }),
    ).resolves.toMatchObject({ status: 'approved' });
    expect(reviewCases.close).not.toHaveBeenCalled();
  });
});

describe('C-3 · una decisión humana se escribe como humana', () => {
  it('un producto requiresManualReview (decision_mode NULL) queda con decision_mode = manual', async () => {
    const application: App = { id: '43', status: 'under_review', decisionMode: null, decisionExecutionId: null };
    const { service, creditRepository } = build(application);

    await service.decide({ tenantId: '7', applicationId: '43', currentUser: operador, body: { decision: 'approve', reasonCode: 'ok' } });

    // Antes la decisión humana sólo tocaba status y motivo: la fila se quedaba con `decision_mode`
    // NULO, justo lo que la migración 20260914200000 quería evitar.
    expect(creditRepository.updateApplicationStatus).toHaveBeenCalledWith(
      application,
      expect.objectContaining({ decisionMode: 'manual' }),
      expect.anything(),
    );
    expect(application.decisionMode).toBe('manual');
  });

  it('una solicitud que el Motor mandó a revisión y una persona resolvió deja de figurar como decisión del Motor', async () => {
    const application = revisionSinCasoDelMotor();
    const { service } = build(application);

    await service.decide({ tenantId: '7', applicationId: '41', currentUser: operador, body: { decision: 'approve', reasonCode: 'ok' } });

    // Si se quedara `decision_engine`, «cuánto aprueba el Motor» contaría una aprobación que dio una persona.
    expect(application.decisionMode).toBe('manual');
  });

  it('conserva engine_unavailable_manual: dice POR QUÉ tuvo que decidir una persona', async () => {
    const application: App = { id: '44', status: 'under_review', decisionMode: 'engine_unavailable_manual', decisionExecutionId: null };
    const { service } = build(application);

    await service.decide({ tenantId: '7', applicationId: '44', currentUser: operador, body: { decision: 'approve', reasonCode: 'ok' } });

    expect(application.decisionMode).toBe('engine_unavailable_manual');
  });
});

describe('CreditReviewCaseRepository · el caso propio de Atlas', () => {
  function buildRepository(existing: Record<string, unknown> | null = null) {
    const caseModel = {
      findOne: jest.fn(async (..._args: unknown[]) => existing),
      create: jest.fn(async (values: unknown, _options?: unknown) => ({ id: '900', ...(values as Record<string, unknown>) })),
    };
    return { repository: new CreditReviewCaseRepository(caseModel as never), caseModel };
  }

  const now = new Date('2026-09-25T12:00:00.000Z');
  const values = { tenantId: '7', customerId: '10', applicationCode: 'CRA-41', notes: 'El motor derivó la solicitud a revisión.', now };

  it('abre un caso de crédito NO delegado: sin ejecución del Motor, que es el punto', async () => {
    const { repository, caseModel } = buildRepository();

    const opened = await repository.open(values, { transaction: { id: 'tx' } as never });

    expect(caseModel.create).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: '7',
        caseCode: 'CR-CRA-41',
        customerId: '10',
        caseType: 'credit_application_review',
        status: 'open',
        // Delegado sería el mismo callejón: `MANUAL_REVIEW_DELEGADA_AL_MOTOR` sin caso en el Motor.
        decisionExecutionId: null,
        riskAssessmentRunId: null,
      }),
      { transaction: { id: 'tx' } },
    );
    expect(opened.caseCode).toBe('CR-CRA-41');
  });

  it('es idempotente por solicitud: la petición original y el barrido no abren dos casos', async () => {
    const { repository, caseModel } = buildRepository({ id: '900', caseCode: 'CR-CRA-41' });

    const opened = await repository.open(values, {});

    expect(caseModel.create).not.toHaveBeenCalled();
    expect(opened).toMatchObject({ id: '900' });
  });

  it('cierra el caso abierto con la resolución y la fecha', async () => {
    const found = {
      status: 'open',
      closedAt: null as Date | null,
      resolution: null as string | null,
      notes: 'notas',
      save: jest.fn(async (..._args: unknown[]) => undefined),
    };
    const { repository } = buildRepository(found);

    await expect(repository.close({ tenantId: '7', caseCode: 'CR-CRA-41', resolution: 'approve', notes: null, now }, {})).resolves.toBe(
      true,
    );

    expect(found).toMatchObject({ status: 'closed', resolution: 'approve', closedAt: now, notes: 'notas' });
    expect(found.save).toHaveBeenCalledTimes(1);
  });

  it('no reabre ni pisa un caso ya cerrado, ni falla si no hay caso', async () => {
    const closed = { status: 'closed', closedAt: now, save: jest.fn() };
    await expect(
      buildRepository(closed).repository.close({ tenantId: '7', caseCode: 'CR-CRA-41', resolution: 'approve', notes: null, now }, {}),
    ).resolves.toBe(false);
    expect(closed.save).not.toHaveBeenCalled();

    await expect(
      buildRepository(null).repository.close({ tenantId: '7', caseCode: 'CR-NADA', resolution: 'approve', notes: null, now }, {}),
    ).resolves.toBe(false);
  });
});

describe('C-1 de punta a punta · el Motor dice review sin caso → hay caso propio y la decisión humana lo resuelve', () => {
  it('aparece un caso en manual_review_cases y decidir la solicitud lo cierra, sin 409', async () => {
    // Una solicitud y una tabla de casos EN MEMORIA compartidas por los dos servicios reales.
    const application: App = {
      id: '51',
      applicationCode: 'CRA-51',
      customerId: '10',
      status: 'submitted',
      decisionMode: null,
      decisionExecutionId: null,
      manualReviewCaseCode: null,
      manualReviewCaseSource: null,
      save: jest.fn(async (..._args: unknown[]) => undefined),
    };
    const cases: Array<Record<string, unknown>> = [];
    const reviewCases = {
      open: jest.fn(async (values: Record<string, unknown>, _options?: unknown) => {
        const created = { caseCode: `CR-${String(values.applicationCode)}`, customerId: values.customerId, status: 'open' };
        cases.push(created);
        return created;
      }),
      close: jest.fn(async (values: Record<string, unknown>, _options?: unknown) => {
        const found = cases.find((entry) => entry.caseCode === values.caseCode);
        if (found) found.status = 'closed';
        return Boolean(found);
      }),
    };
    const credit = {
      findApplicationById: jest.fn(async (..._args: unknown[]) => application),
      createApplicationEvent: jest.fn(async (..._args: unknown[]) => undefined),
      updateApplicationStatus: jest.fn(async (...args: unknown[]) => {
        const [app, values] = args as [App, Record<string, unknown>];
        Object.assign(app, { status: values.status, decisionMode: values.decisionMode });
        return app;
      }),
    };
    const sequelize = { transaction: jest.fn(async (cb: (t: unknown) => Promise<unknown>) => cb({})) };
    const engine = {
      decide: jest.fn(async (..._args: unknown[]) => ({
        outcome: {
          kind: 'review',
          // `review` SIN `manualReview.caseCode`: el Motor no abrió bandeja.
          response: { executionId: '9051', status: 'COMPLETED', outcome: 'MANUAL_REVIEW', reasonCodes: [], manualReview: null },
        },
        subjectReference: 'hash',
        excludedFeatures: [],
      })),
    };
    const underwriting = new CreditUnderwritingService(engine as never, credit as never, sequelize as never, reviewCases as never);
    const decisions = new CreditDecisionService(credit as never, sequelize as never, reviewCases as never);

    const underwritten = await underwriting.underwrite({
      tenantId: '7',
      applicationId: '51',
      customerId: '10',
      applicationCode: 'CRA-51',
      requestedAmount: '2000.00',
      requestedTermMonths: 6,
      currencyCode: 'BOB',
      productCode: 'consumo_30',
      purposeCode: null,
    });

    expect(underwritten.status).toBe('under_review');
    expect(cases).toEqual([{ caseCode: 'CR-CRA-51', customerId: '10', status: 'open' }]);

    // Antes de C-1 esto era el 409 CREDIT_DECISION_DELEGADA_AL_MOTOR y la solicitud no tenía salida.
    await expect(
      decisions.decide({ tenantId: '7', applicationId: '51', currentUser: operador, body: { decision: 'approve', reasonCode: 'ok' } }),
    ).resolves.toMatchObject({ status: 'approved', previousStatus: 'under_review' });
    expect(application).toMatchObject({ status: 'approved', decisionMode: 'manual' });
    expect(cases[0].status).toBe('closed');
  });
});
