/**
 * @file Si el intento no guardó `executionId`, el callback del Motor igual encuentra a quién aplicar la decisión.
 * @business Un intento que dio por perdida la llamada al Motor (plazo agotado) nunca conoció su ejecución:
 *   el Motor la terminó y abrió su caso, y aprobarlo allí daba 404, así que el cliente se quedaba en revisión.
 * @system Unitaria sobre el controlador: la búsqueda por `executionId` falla y se prueba el respaldo por
 *   `correlationId` (id del intento) y por `requestId` (`identity-<cliente>-<uuid>`).
 */
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { IdentityReviewCallbackController } from '../../../src/modules/customer-onboarding/identity-review-callback.controller.js';
import { env } from '../../../src/config/env.js';

type Mutable = { ENGINE_CALLBACK_API_KEY?: string };
const CLAVE = 'clave-del-motor';
const UUID = '3a9eb5d6-cfb1-47b8-bbd5-220257cdf0f6';

const porEjecucion = jest.fn(async (..._a: unknown[]) => null as unknown);
const porId = jest.fn(async (..._a: unknown[]) => null as unknown);
const apply = jest.fn(async (..._a: unknown[]) => ({ applied: true }));
const applyForCustomer = jest.fn(async (..._a: unknown[]) => ({ applied: true }));

function controlador(): IdentityReviewCallbackController {
  return new IdentityReviewCallbackController(
    { apply, applyForCustomer } as never,
    { findAttemptByExecutionId: porEjecucion, findAttemptById: porId } as never,
  );
}
const base = { executionId: 'exec-9', decision: 'APPROVE', resolvedByInternalUserId: '1' };

describe('callback de identidad: respaldo cuando falta el executionId en el intento', () => {
  beforeEach(() => {
    for (const mock of [porEjecucion, porId, apply, applyForCustomer]) mock.mockClear();
    porEjecucion.mockResolvedValue(null);
    porId.mockResolvedValue(null);
    (env as Mutable).ENGINE_CALLBACK_API_KEY = CLAVE;
  });

  it('con el intento por executionId no usa el respaldo', async () => {
    porEjecucion.mockResolvedValue({ id: 5 });
    await controlador().aplicar('1', CLAVE, { ...base, correlationId: '77' });
    expect(apply).toHaveBeenCalledWith(expect.objectContaining({ attemptId: '5', decision: 'approved' }));
    expect(porId).not.toHaveBeenCalled();
  });

  it('sin executionId en el intento, lo halla por correlationId (id del intento)', async () => {
    porId.mockResolvedValue({ id: 77, customerId: '53' });
    await controlador().aplicar('1', CLAVE, { ...base, correlationId: '77' });
    expect(porId).toHaveBeenCalledWith('1', '77');
    expect(apply).toHaveBeenCalledWith(expect.objectContaining({ attemptId: '77', decision: 'approved' }));
  });

  it('sin intento por id, aplica al cliente que lleva el requestId', async () => {
    await controlador().aplicar('1', CLAVE, { ...base, decision: 'DECLINE', requestId: `identity-53-${UUID}` });
    expect(applyForCustomer).toHaveBeenCalledWith(expect.objectContaining({ customerId: '53', decision: 'rejected' }));
    expect(apply).not.toHaveBeenCalled();
  });

  it('un correlationId que no es un id numérico no se consulta', async () => {
    await expect(controlador().aplicar('1', CLAVE, { ...base, correlationId: "1' OR '1'='1" })).rejects.toThrow(/ejecucion exec-9/i);
    expect(porId).not.toHaveBeenCalled();
  });

  it('sin ninguna pista sigue siendo 404', async () => {
    await expect(controlador().aplicar('1', CLAVE, { ...base, requestId: 'otro-formato' })).rejects.toThrow(/ejecucion exec-9/i);
    expect(applyForCustomer).not.toHaveBeenCalled();
  });
});
