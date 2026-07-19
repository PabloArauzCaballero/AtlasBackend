import { describe, expect, it, jest } from '@jest/globals';
import { CustomerSessionsController, OperationsSessionsController } from '../../../src/modules/sessions/sessions.controller.js';
import { tenantIdFromHeader, userAgentFrom } from '../../../src/common/utils/http/headers.util.js';

/**
 * `CustomerSessionsController` arma un `context` (tenant + IP + user-agent + idempotencyKey) al delegar
 * en `SessionsService`, y `OperationsSessionsController` expone el resumen interno de una sesión. Spec
 * directo con el servicio mockeado.
 */
describe('sessions controllers', () => {
  const user = { role: 'customer', tenantId: '1', customerId: '9' } as never;
  const request = { ip: '5.5.5.5', headers: { 'user-agent': 'jest-ua' } } as never;
  const expectedContext = { tenantId: tenantIdFromHeader('1'), ipAddress: '5.5.5.5', userAgent: userAgentFrom(request), idempotencyKey: 'idem' };

  it('startSession arma el context y exige idempotency-key', async () => {
    const service = { startSession: jest.fn(async () => ({ sessionId: 's1' })) };
    const controller = new CustomerSessionsController(service as never);
    const body = { deviceId: 'd1' } as never;
    await controller.startSession('1', 'idem', { customerId: '9' } as never, body, user, request);
    expect(service.startSession).toHaveBeenCalledWith({ customerId: '9', body, currentUser: user, context: expectedContext });
    expect(() => controller.startSession('1', undefined, { customerId: '9' } as never, body, user, request)).toThrow();
  });

  it('heartbeat exige idempotency-key y delega con sessionId', async () => {
    const service = { heartbeat: jest.fn(async () => ({})) };
    const controller = new CustomerSessionsController(service as never);
    await controller.heartbeat('1', 'idem', { customerId: '9', sessionId: 's1' } as never, { deviceId: 'd1' } as never, user, request);
    expect((service.heartbeat.mock.calls[0][0] as { sessionId: string }).sessionId).toBe('s1');
    expect(() => controller.heartbeat('1', undefined, { customerId: '9', sessionId: 's1' } as never, {} as never, user, request)).toThrow();
  });

  it('getSessionState delega sin idempotency-key', async () => {
    const service = { getSessionState: jest.fn(async () => ({ active: false })) };
    const controller = new CustomerSessionsController(service as never);
    await controller.getSessionState('1', { customerId: '9' } as never, user);
    expect(service.getSessionState).toHaveBeenCalledWith({ tenantId: tenantIdFromHeader('1'), customerId: '9', currentUser: user });
  });

  it('OperationsSessionsController.getInvestigationSummary delega con sessionId', async () => {
    const service = { getOperationsSessionSummary: jest.fn(async () => ({})) };
    const controller = new OperationsSessionsController(service as never);
    const internal = { role: 'risk_analyst', tenantId: '1', internalUserId: 'u1' } as never;
    await controller.getInvestigationSummary('1', { sessionId: 's1' } as never, internal);
    expect(service.getOperationsSessionSummary).toHaveBeenCalledWith({ tenantId: tenantIdFromHeader('1'), sessionId: 's1', currentUser: internal });
  });
});
