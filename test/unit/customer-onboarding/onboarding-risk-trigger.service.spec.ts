/**
 * @file Verifica la evaluación de riesgo que dispara el envío del onboarding y el dispositivo que lleva.
 * @business `device_score` no puede valer lo mismo para todos porque el envío nunca dijo con qué dispositivo se hizo el alta.
 * @system Ejercita `OnboardingRiskTriggerService` (C-6): resolución del dispositivo en el servidor y degradación sin tumbar el envío.
 */
import { describe, expect, it, jest } from '@jest/globals';
import { Op } from 'sequelize';
import { OnboardingRiskTriggerService } from '../../../src/modules/customer-onboarding/application/onboarding-risk-trigger.service.js';
import { computeHeuristicScores } from '../../../src/modules/risk/application/risk-heuristic-scoring.js';

const currentUser = { sub: 'customer-1', role: 'customer', customerId: 'c1', tenantId: 't1' } as never;
const input = { tenantId: 't1', customerId: 'c1', currentUser, idempotencyKey: 'idem-1' };

function build(link: { deviceId: string | null } | null = { deviceId: '55' }) {
  const riskService = { createRiskAssessment: jest.fn(async (..._args: unknown[]) => ({ id: 'risk-1' })) };
  const deviceLinks = { findOne: jest.fn(async (..._args: unknown[]) => link) };
  const service = new OnboardingRiskTriggerService(riskService as never, deviceLinks as never);
  return { service, riskService, deviceLinks };
}

describe('OnboardingRiskTriggerService', () => {
  it('manda el dispositivo del cliente en la evaluación: el envío ya no viaja sin deviceId', async () => {
    const { service, riskService } = build({ deviceId: '55' });

    await service.run(input);

    expect(riskService.createRiskAssessment).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: 't1',
        customerId: 'c1',
        body: { assessmentType: 'onboarding_initial', channel: 'system', deviceId: '55' },
        idempotencyKey: 'idem-1:onboarding-risk',
      }),
    );
  });

  it('con dispositivo, device_score deja de ser el 55 constante de quien no lo mandaba', async () => {
    const { service, riskService } = build({ deviceId: '55' });
    await service.run(input);
    const [[call]] = riskService.createRiskAssessment.mock.calls as unknown as [[{ body: { deviceId?: string } }]];

    // `RiskService` deriva `hasDevice` de `body.deviceId`: eso es lo que separa el 70 del 55.
    const withDevice = computeHeuristicScores({ hasIdentity: true, verifiedContactCount: 1, hasDevice: Boolean(call.body.deviceId) });
    const withoutDevice = computeHeuristicScores({ hasIdentity: true, verifiedContactCount: 1, hasDevice: false });
    expect(withDevice.deviceScore).toBe(70);
    expect(withoutDevice.deviceScore).toBe(55);
  });

  it('sin dispositivo vinculado NO inventa uno: la evaluación va sin deviceId', async () => {
    const { service, riskService } = build(null);

    await service.run(input);

    const [[call]] = riskService.createRiskAssessment.mock.calls as unknown as [[{ body: Record<string, unknown> }]];
    expect(call.body).toEqual({ assessmentType: 'onboarding_initial', channel: 'system' });
    expect(call.body).not.toHaveProperty('deviceId');
  });

  it('busca el dispositivo ACTIVO más recientemente visto, del cliente y del tenant', async () => {
    const { service, deviceLinks } = build();

    await service.run(input);

    expect(deviceLinks.findOne).toHaveBeenCalledWith({
      where: { tenantId: 't1', customerId: 'c1', linkStatus: 'active', deviceId: { [Op.ne]: null }, deleted: { [Op.ne]: true } },
      order: [
        ['lastSeenAt', 'DESC NULLS LAST'],
        ['id', 'DESC'],
      ],
    });
  });

  it('el deviceId lo resuelve el servidor: no hay campo del cuerpo con el que un cliente declare un dispositivo ajeno', async () => {
    const { service, riskService } = build({ deviceId: '55' });

    await service.run({ ...input, ...({ deviceId: '999' } as object) });

    const [[call]] = riskService.createRiskAssessment.mock.calls as unknown as [[{ body: { deviceId?: string } }]];
    expect(call.body.deviceId).toBe('55');
  });

  it('si la consulta del dispositivo falla, la evaluación de riesgo se hace igual, sin dispositivo', async () => {
    const { service, riskService, deviceLinks } = build();
    deviceLinks.findOne.mockRejectedValueOnce(new Error('timeout') as never);

    await service.run(input);

    expect(riskService.createRiskAssessment).toHaveBeenCalledTimes(1);
    const [[call]] = riskService.createRiskAssessment.mock.calls as unknown as [[{ body: Record<string, unknown> }]];
    expect(call.body).not.toHaveProperty('deviceId');
  });

  it('si la evaluación falla, no lanza: el envío igual procede', async () => {
    const { service, riskService } = build();
    riskService.createRiskAssessment.mockRejectedValueOnce(new Error('motor caído') as never);

    await expect(service.run(input)).resolves.toBeUndefined();
  });
});
