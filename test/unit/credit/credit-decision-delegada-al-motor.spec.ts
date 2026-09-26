import { describe, expect, it, jest } from '@jest/globals';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { CreditDecisionService } from '../../../src/modules/credit/application/credit-decision.service.js';

/**
 * Una solicitud que el Motor YA decidió no se decide a mano, y la revisión hecha EN el Motor vuelve.
 *
 * Medido el 2026-09-14: `POST /operations/credit/applications/:id/decision` aprobaba —y dejaba
 * desembolsable— cualquier solicitud abierta sin mirar `decisionMode`, incluida una que el Motor
 * había derivado a su propia cola. Y esa cola no tenía camino de vuelta: el analista aprobaba allí
 * y aquí la solicitud seguía `under_review` para siempre.
 */
const operador = { sub: 'operator-3', tenantId: '7', internalUserId: '3', role: 'admin' } as never;

function build(application: Record<string, unknown> | null) {
  const transaction = { id: 'tx' };
  const creditRepository = {
    findApplicationById: jest.fn(async (..._args: unknown[]) => application),
    findApplicationByExecutionId: jest.fn(async (..._args: unknown[]) => application),
    updateApplicationStatus: jest.fn(async (...args: unknown[]) => {
      const [app, values] = args as [Record<string, unknown>, Record<string, unknown>];
      Object.assign(app, { status: values.status });
      return app;
    }),
    createApplicationEvent: jest.fn(async (..._args: unknown[]) => undefined),
  };
  const sequelize = { transaction: jest.fn(async (cb: (t: unknown) => Promise<unknown>) => cb(transaction)) };
  return { creditRepository, transaction, service: new CreditDecisionService(creditRepository as never, sequelize as never) };
}

const decididaPorElMotor = () => ({
  id: '31',
  applicationCode: 'CRA-31',
  status: 'under_review',
  decisionMode: 'decision_engine',
  decisionExecutionId: '9001',
  businessAcceptance: null as string | null,
  save: jest.fn(async (..._args: unknown[]) => undefined),
});

describe('CreditDecisionService · la decisión humana respeta al Motor', () => {
  it('rechaza con CREDIT_DECISION_DELEGADA_AL_MOTOR una solicitud con ejecución del Motor', async () => {
    const { service, creditRepository } = build(decididaPorElMotor());
    await expect(
      service.decide({ tenantId: '7', applicationId: '31', currentUser: operador, body: { decision: 'approve', reasonCode: 'ok' } }),
    ).rejects.toThrow(/CREDIT_DECISION_DELEGADA_AL_MOTOR/);
    expect(creditRepository.updateApplicationStatus).not.toHaveBeenCalled();
    expect(creditRepository.createApplicationEvent).not.toHaveBeenCalled();
  });

  it('sigue admitiendo la decisión humana cuando el Motor NO llegó a decidir (engine_unavailable_manual)', async () => {
    const { service, creditRepository } = build({
      id: '32',
      status: 'under_review',
      decisionMode: 'engine_unavailable_manual',
      decisionExecutionId: null,
    });
    await expect(
      service.decide({ tenantId: '7', applicationId: '32', currentUser: operador, body: { decision: 'approve', reasonCode: 'ok' } }),
    ).resolves.toMatchObject({ status: 'approved' });
    expect(creditRepository.updateApplicationStatus).toHaveBeenCalledTimes(1);
  });

  it('y cuando la solicitud es anterior a la integración (sin modo ni ejecución)', async () => {
    const { service } = build({ id: '33', status: 'under_review', decisionMode: null, decisionExecutionId: null });
    await expect(
      service.decide({
        tenantId: '7',
        applicationId: '33',
        currentUser: operador,
        body: { decision: 'reject', reasonCode: 'x', notes: 'n' },
      }),
    ).resolves.toMatchObject({ status: 'rejected' });
  });
});

describe('CreditDecisionService · la revisión hecha en el Motor vuelve', () => {
  it('APPROVE aprueba la solicitud por su ejecución y la deja pendiente de la aceptación del negocio', async () => {
    const app = decididaPorElMotor();
    const { service, creditRepository, transaction } = build(app);

    const result = await service.applyEngineManualReview({
      tenantId: '7',
      executionId: '9001',
      decision: 'APPROVE',
      reason: 'Documentación conforme',
      resolvedByInternalUserId: '12',
    });

    expect(result).toEqual({ applied: true, applicationId: '31', previousStatus: 'under_review', status: 'approved' });
    expect(creditRepository.findApplicationByExecutionId).toHaveBeenCalledWith('7', '9001', { transaction });
    expect(creditRepository.updateApplicationStatus).toHaveBeenCalledWith(
      app,
      expect.objectContaining({ status: 'approved', reasonCode: 'engine_manual_review_approved', decidedByInternalUserId: '12' }),
      { transaction },
    );
    // Sigue siendo una aprobación del MOTOR: el negocio aún no contestó su pregunta.
    expect(app.businessAcceptance).toBe('pending');
    expect(app.save).toHaveBeenCalledWith({ transaction });
    expect(creditRepository.createApplicationEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: 'decision_recorded',
        actorType: 'decision_engine_manual_review',
        newStatus: 'approved',
        payloadJson: { decision: 'APPROVE', executionId: '9001' },
        notes: 'Documentación conforme',
      }),
      { transaction },
    );
  });

  it('DECLINE rechaza sin tocar la aceptación del negocio', async () => {
    const app = decididaPorElMotor();
    const { service } = build(app);
    await expect(
      service.applyEngineManualReview({
        tenantId: '7',
        executionId: '9001',
        decision: 'DECLINE',
        reason: 'No cumple',
        resolvedByInternalUserId: null,
      }),
    ).resolves.toMatchObject({ applied: true, status: 'rejected' });
    expect(app.businessAcceptance).toBeNull();
    expect(app.save).not.toHaveBeenCalled();
  });

  it('una solicitud ya cerrada no se vuelve a decidir, y lo dice sin lanzar', async () => {
    const { service, creditRepository } = build({ ...decididaPorElMotor(), status: 'approved' });
    await expect(
      service.applyEngineManualReview({
        tenantId: '7',
        executionId: '9001',
        decision: 'APPROVE',
        reason: 'x',
        resolvedByInternalUserId: null,
      }),
    ).resolves.toMatchObject({ applied: false, reason: 'CREDIT_APPLICATION_ALREADY_DECIDED' });
    expect(creditRepository.updateApplicationStatus).not.toHaveBeenCalled();
  });

  it('una ejecución que no produjo ninguna solicitud es 404', async () => {
    const { service } = build(null);
    await expect(
      service.applyEngineManualReview({
        tenantId: '7',
        executionId: 'nadie',
        decision: 'APPROVE',
        reason: 'x',
        resolvedByInternalUserId: null,
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('ConflictException es la clase del corte: una pantalla se salta con curl, el servicio no', async () => {
    const { service } = build(decididaPorElMotor());
    await expect(
      service.decide({ tenantId: '7', applicationId: '31', currentUser: operador, body: { decision: 'approve', reasonCode: 'ok' } }),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});
