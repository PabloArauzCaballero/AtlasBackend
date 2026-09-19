import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { UnauthorizedException } from '@nestjs/common';
import { CreditReviewCallbackController } from '../../../src/modules/credit/credit-review-callback.controller.js';
import { RiskReviewCallbackController } from '../../../src/modules/risk/risk-review-callback.controller.js';
import { env } from '../../../src/config/env.js';

type Mutable = { ENGINE_CALLBACK_API_KEY?: string };

/**
 * Los dos callbacks nuevos (riesgo y crédito) exigen la misma credencial de servicio que el de
 * identidad: sin clave CONFIGURADA no pasa nadie, ni con cabecera.
 */
describe.each([
  ['crédito', (apply: unknown) => new CreditReviewCallbackController({ applyEngineManualReview: apply } as never)],
  ['riesgo', (apply: unknown) => new RiskReviewCallbackController({ apply } as never)],
])('callback de revisión del Motor · %s', (_nombre, construir) => {
  const original = env.ENGINE_CALLBACK_API_KEY;
  const aplicar = jest.fn(async (..._args: unknown[]) => ({ applied: true }));
  const cuerpo = { executionId: 'exec-1', decision: 'APPROVE', resolvedByInternalUserId: '7', reason: 'ok' };

  beforeEach(() => {
    aplicar.mockClear();
    (env as Mutable).ENGINE_CALLBACK_API_KEY = original;
  });

  it('sin credencial CONFIGURADA no acepta a nadie', async () => {
    (env as Mutable).ENGINE_CALLBACK_API_KEY = undefined;
    await expect(construir(aplicar).aplicar('1', 'la-que-sea', cuerpo)).rejects.toBeInstanceOf(UnauthorizedException);
    expect(aplicar).not.toHaveBeenCalled();
  });

  it('con credencial configurada, sin cabecera o con otra se rechaza', async () => {
    (env as Mutable).ENGINE_CALLBACK_API_KEY = 'clave';
    await expect(construir(aplicar).aplicar('1', undefined, cuerpo)).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(construir(aplicar).aplicar('1', 'otra', cuerpo)).rejects.toBeInstanceOf(UnauthorizedException);
    expect(aplicar).not.toHaveBeenCalled();
  });

  it('con la credencial correcta aplica la resolución, con la persona sólo si es un id de esta base', async () => {
    (env as Mutable).ENGINE_CALLBACK_API_KEY = 'clave';
    await construir(aplicar).aplicar('1', 'clave', { ...cuerpo, resolvedByInternalUserId: 'bootstrap-management' });
    expect(aplicar).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: '1', executionId: 'exec-1', decision: 'APPROVE', resolvedByInternalUserId: null, reason: 'ok' }),
    );
    await construir(aplicar).aplicar('1', 'clave', cuerpo);
    expect(aplicar).toHaveBeenLastCalledWith(expect.objectContaining({ resolvedByInternalUserId: '7' }));
  });

  it('CANCEL no es una decisión: no se aplica nada', async () => {
    (env as Mutable).ENGINE_CALLBACK_API_KEY = 'clave';
    await expect(construir(aplicar).aplicar('1', 'clave', { ...cuerpo, decision: 'CANCEL' })).resolves.toEqual({
      applied: false,
      reason: 'DECISION_NO_APLICABLE',
    });
    expect(aplicar).not.toHaveBeenCalled();
  });

  it('sin executionId es 400', async () => {
    (env as Mutable).ENGINE_CALLBACK_API_KEY = 'clave';
    await expect(construir(aplicar).aplicar('1', 'clave', { decision: 'APPROVE' })).rejects.toThrow(/executionId/);
  });
});
