/**
 * @file El anexo del expediente del alta al caso del Motor: «la evidencia se pierde, el alta no».
 * @business Si el Motor no contesta, la persona sigue con su alta; el caso se completa en el siguiente hito.
 * @system Ejercita `OnboardingReviewDossierPublisher.publish` con el puerto del Motor simulado.
 */
import { describe, expect, it, jest } from '@jest/globals';
import { OnboardingReviewDossierPublisher } from '../../../src/modules/customer-onboarding/application/onboarding-review-dossier.publisher.js';

function build(intento: unknown = null) {
  const dossiers = { build: jest.fn(async (..._args: unknown[]) => ({ version: 1, cliente: { customerId: 'c1' } })) };
  const engine = {
    putOnboardingDossier: jest.fn(async (..._args: unknown[]) => ({ ok: true, status: 200, caseCode: 'MR-1', created: false })),
  };
  const attempts = { findOne: jest.fn(async (..._args: unknown[]) => intento) };
  const publisher = new OnboardingReviewDossierPublisher(dossiers as never, engine as never, attempts as never);
  return { publisher, dossiers, engine, attempts };
}

describe('OnboardingReviewDossierPublisher', () => {
  it('con ejecución explícita y openIfMissing, arma el expediente y lo manda tal cual', async () => {
    const { publisher, engine, attempts } = build();

    const salida = await publisher.publish({
      tenantId: 't1',
      customerId: 'c1',
      momento: 'identidad',
      executionId: 'ex-9',
      openIfMissing: { queueCode: 'IDENTIDAD', motivo: 'REVISION_HUMANA_OBLIGATORIA' },
    });

    expect(attempts.findOne).not.toHaveBeenCalled();
    expect(engine.putOnboardingDossier).toHaveBeenCalledWith('ex-9', {
      dossier: { version: 1, cliente: { customerId: 'c1' } },
      openIfMissing: { queueCode: 'IDENTIDAD', motivo: 'REVISION_HUMANA_OBLIGATORIA' },
    });
    expect(salida).toMatchObject({ sent: true, executionId: 'ex-9', reason: null });
  });

  it('sin ejecución, usa la del último intento MÓVIL; si sigue retenido por la política, pide abrir el caso', async () => {
    const { publisher, engine, attempts } = build({
      finalResult: 'IN_REVIEW',
      reasonCodesJson: { executionId: 'ex-7', humanReviewPolicy: true },
    });

    await publisher.publish({ tenantId: 't1', customerId: 'c1', momento: 'envio' });

    expect(attempts.findOne).toHaveBeenCalledWith(
      expect.objectContaining({ where: { tenantId: 't1', customerId: 'c1', verificationChannel: 'MOBILE_APP' } }),
    );
    expect(engine.putOnboardingDossier).toHaveBeenCalledWith('ex-7', {
      dossier: expect.any(Object),
      openIfMissing: { queueCode: 'IDENTIDAD', motivo: 'REVISION_HUMANA_OBLIGATORIA' },
    });
  });

  it('un intento en REVISION_HUMANA del Motor (sin política) también pide abrir si faltara, con su motivo', async () => {
    const { publisher, engine } = build({ finalResult: 'IN_REVIEW', reasonCodesJson: { executionId: 'ex-6' } });

    await publisher.publish({ tenantId: 't1', customerId: 'c1', momento: 'envio' });

    expect(engine.putOnboardingDossier).toHaveBeenCalledWith('ex-6', {
      dossier: expect.any(Object),
      openIfMissing: { queueCode: 'IDENTIDAD', motivo: 'REVISION_HUMANA_DEL_MOTOR' },
    });
  });

  it('un caso ya cerrado en el Motor (409) es final: no enviado, sin lanzar', async () => {
    const { publisher, engine } = build();
    (engine.putOnboardingDossier as jest.Mock).mockResolvedValueOnce({
      ok: false,
      status: 409,
      reason: 'MANUAL_REVIEW_CLOSED',
      final: true,
    } as never);

    await expect(publisher.publish({ tenantId: 't1', customerId: 'c1', momento: 'envio', executionId: 'ex-1' })).resolves.toMatchObject({
      sent: false,
      reason: 'MANUAL_REVIEW_CLOSED',
      result: { final: true },
    });
  });

  it('un intento ya resuelto sólo fusiona: no pide abrir caso para lo decidido', async () => {
    const { publisher, engine } = build({ finalResult: 'VERIFIED', reasonCodesJson: { executionId: 'ex-8', humanReviewPolicy: true } });

    await publisher.publish({ tenantId: 't1', customerId: 'c1', momento: 'envio' });

    expect(engine.putOnboardingDossier).toHaveBeenCalledWith('ex-8', { dossier: expect.any(Object) });
  });

  it('sin intento móvil con ejecución no manda nada y lo dice', async () => {
    const { publisher, engine, dossiers } = build({
      finalResult: 'UNAVAILABLE',
      reasonCodesJson: { reason: 'DECISION_ENGINE_UNAVAILABLE' },
    });

    const salida = await publisher.publish({ tenantId: 't1', customerId: 'c1', momento: 'envio' });

    expect(salida).toEqual({ sent: false, executionId: null, result: null, reason: 'SIN_EJECUCION_DE_IDENTIDAD' });
    expect(dossiers.build).not.toHaveBeenCalled();
    expect(engine.putOnboardingDossier).not.toHaveBeenCalled();
  });

  it('un 404 del Motor (no hay caso y no se pidió abrir) se devuelve como no enviado, sin lanzar', async () => {
    const { publisher, engine } = build();
    (engine.putOnboardingDossier as jest.Mock).mockResolvedValueOnce({
      ok: false,
      status: 404,
      reason: 'MANUAL_REVIEW_NOT_FOUND',
      final: false,
    } as never);

    await expect(publisher.publish({ tenantId: 't1', customerId: 'c1', momento: 'identidad', executionId: 'ex-1' })).resolves.toMatchObject(
      {
        sent: false,
        reason: 'MANUAL_REVIEW_NOT_FOUND',
      },
    );
  });

  it('si armar el expediente revienta, NUNCA lanza: el alta sigue', async () => {
    const { publisher, dossiers, engine } = build();
    (dossiers.build as jest.Mock).mockRejectedValueOnce(new Error('conexión cerrada') as never);

    await expect(publisher.publish({ tenantId: 't1', customerId: 'c1', momento: 'envio', executionId: 'ex-1' })).resolves.toEqual({
      sent: false,
      executionId: 'ex-1',
      result: null,
      reason: 'conexión cerrada',
    });
    expect(engine.putOnboardingDossier).not.toHaveBeenCalled();
  });

  it('si la consulta del intento revienta, tampoco lanza', async () => {
    const { publisher, attempts } = build();
    (attempts.findOne as jest.Mock).mockRejectedValueOnce('fallo raro' as never);

    await expect(publisher.publish({ tenantId: 't1', customerId: 'c1', momento: 'envio' })).resolves.toMatchObject({
      sent: false,
      reason: 'fallo raro',
    });
  });
});
