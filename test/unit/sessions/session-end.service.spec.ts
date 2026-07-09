import { describe, expect, it, jest } from '@jest/globals';
import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { SessionEndService } from '../../../src/modules/sessions/application/session-end.service.js';

/**
 * ATLAS-P12d (extensión — `docs/testing/PLAN_RED_DE_PRUEBAS_ATLAS_P12.md` §9, punto 5):
 * `SessionEndService.endSession` — el más pequeño de los servicios de sesión sin cubrir, pero con
 * la misma regla `SESSION_NOT_ACTIVE` que `heartbeat` (no se puede terminar dos veces una sesión
 * ya terminada) y una regla propia: si no se envía `deviceId`, se usa el de la sesión — nunca se
 * pierde el rastro de qué dispositivo estuvo activo.
 */
describe('SessionEndService.endSession', () => {
  function buildService() {
    const sessionsRepository = {
      findSessionById: jest.fn(),
      endSession: jest.fn(),
      createAuthEvent: jest.fn(),
      createCustomerAction: jest.fn(),
      upsertActivitySummary: jest.fn(),
      createAudit: jest.fn(),
    };
    const sequelize = { transaction: jest.fn(async (cb: (t: unknown) => Promise<unknown>) => cb({})) };
    const service = new SessionEndService(sessionsRepository as never, sequelize as never);
    return { service, sessionsRepository };
  }

  const customerUser = { role: 'customer', customerId: 'c1', internalUserId: null, platformUserId: null } as never;
  const context = { tenantId: 't1', ipAddress: '10.0.0.1', userAgent: 'AtlasApp/1.0', idempotencyKey: 'idem-1' };

  it('throws BadRequestException without an idempotency key', async () => {
    const { service } = buildService();
    await expect(
      service.endSession({
        customerId: 'c1',
        sessionId: 's1',
        body: {} as never,
        currentUser: customerUser,
        context: { ...context, idempotencyKey: undefined },
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('throws ForbiddenException when a customer token ends a session for a different customerId', async () => {
    const { service } = buildService();
    await expect(
      service.endSession({ customerId: 'someone-else', sessionId: 's1', body: {} as never, currentUser: customerUser, context }),
    ).rejects.toThrow(ForbiddenException);
  });

  it('throws NotFoundException when the session does not exist', async () => {
    const { service, sessionsRepository } = buildService();
    (sessionsRepository.findSessionById as jest.Mock).mockResolvedValueOnce(null as never);
    await expect(
      service.endSession({ customerId: 'c1', sessionId: 'missing', body: {} as never, currentUser: customerUser, context }),
    ).rejects.toThrow(NotFoundException);
  });

  it('throws UnprocessableEntityException SESSION_NOT_ACTIVE when the session is already ended', async () => {
    const { service, sessionsRepository } = buildService();
    (sessionsRepository.findSessionById as jest.Mock).mockResolvedValueOnce({
      id: 's1',
      sessionStatus: 'ended',
      deviceId: 'device-1',
    } as never);
    await expect(
      service.endSession({ customerId: 'c1', sessionId: 's1', body: {} as never, currentUser: customerUser, context }),
    ).rejects.toThrow(/SESSION_NOT_ACTIVE/);
    expect(sessionsRepository.endSession).not.toHaveBeenCalled();
  });

  it("throws ForbiddenException when an explicit deviceId in the body does not match the session's own device", async () => {
    const { service, sessionsRepository } = buildService();
    (sessionsRepository.findSessionById as jest.Mock).mockResolvedValueOnce({
      id: 's1',
      sessionStatus: 'active',
      deviceId: 'device-owner',
    } as never);
    await expect(
      service.endSession({
        customerId: 'c1',
        sessionId: 's1',
        body: { deviceId: 'a-different-device' } as never,
        currentUser: customerUser,
        context,
      }),
    ).rejects.toThrow(ForbiddenException);
  });

  it("falls back to the session's own deviceId when the caller does not supply one", async () => {
    const { service, sessionsRepository } = buildService();
    (sessionsRepository.findSessionById as jest.Mock).mockResolvedValueOnce({
      id: 's1',
      sessionStatus: 'active',
      deviceId: 'device-from-session',
    } as never);
    (sessionsRepository.endSession as jest.Mock).mockResolvedValueOnce({ id: 's1', sessionStatus: 'ended' } as never);

    await service.endSession({ customerId: 'c1', sessionId: 's1', body: {} as never, currentUser: customerUser, context });

    const actionArgs = (sessionsRepository.createCustomerAction as jest.Mock).mock.calls[0][0] as { deviceId: string };
    expect(actionArgs.deviceId).toBe('device-from-session');
  });

  it('never increments the session count in the activity summary — ending a session is not starting one', async () => {
    const { service, sessionsRepository } = buildService();
    (sessionsRepository.findSessionById as jest.Mock).mockResolvedValueOnce({
      id: 's1',
      sessionStatus: 'active',
      deviceId: 'device-1',
    } as never);
    (sessionsRepository.endSession as jest.Mock).mockResolvedValueOnce({ id: 's1', sessionStatus: 'ended' } as never);

    await service.endSession({ customerId: 'c1', sessionId: 's1', body: {} as never, currentUser: customerUser, context });

    const summaryArgs = (sessionsRepository.upsertActivitySummary as jest.Mock).mock.calls[0][0] as { incrementSessionCount: boolean };
    expect(summaryArgs.incrementSessionCount).toBe(false);
  });

  it('skips the activity summary update entirely when there is no deviceId at all (neither supplied nor on the session)', async () => {
    const { service, sessionsRepository } = buildService();
    (sessionsRepository.findSessionById as jest.Mock).mockResolvedValueOnce({ id: 's1', sessionStatus: 'active', deviceId: null } as never);
    (sessionsRepository.endSession as jest.Mock).mockResolvedValueOnce({ id: 's1', sessionStatus: 'ended' } as never);

    await service.endSession({ customerId: 'c1', sessionId: 's1', body: {} as never, currentUser: customerUser, context });

    expect(sessionsRepository.upsertActivitySummary).not.toHaveBeenCalled();
  });

  it('returns the final session status and the exact endedAt timestamp used throughout the transaction', async () => {
    const { service, sessionsRepository } = buildService();
    (sessionsRepository.findSessionById as jest.Mock).mockResolvedValueOnce({
      id: 's1',
      sessionStatus: 'active',
      deviceId: 'device-1',
    } as never);
    (sessionsRepository.endSession as jest.Mock).mockResolvedValueOnce({ id: 's1', sessionStatus: 'ended' } as never);

    const result = await service.endSession({
      customerId: 'c1',
      sessionId: 's1',
      body: { endedAt: '2026-06-01T12:00:00.000Z' } as never,
      currentUser: customerUser,
      context,
    });

    expect(result).toEqual({ sessionId: 's1', sessionStatus: 'ended', endedAt: '2026-06-01T12:00:00.000Z' });
  });
});
