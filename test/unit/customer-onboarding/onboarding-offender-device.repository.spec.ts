import { describe, expect, it, jest } from '@jest/globals';
import { OnboardingOffenderDeviceRepository } from '../../../src/modules/customer-onboarding/repositories/onboarding-offender-device.repository.js';

describe('OnboardingOffenderDeviceRepository', () => {
  function build(links: Array<{ deviceId: string | null }>, devices: Array<{ deviceFingerprint: string | null }>) {
    const linkModel = { findAll: jest.fn(async (..._a: unknown[]) => links) };
    const deviceModel = { findAll: jest.fn(async (..._a: unknown[]) => devices) };
    return { repository: new OnboardingOffenderDeviceRepository(linkModel as never, deviceModel as never), linkModel, deviceModel };
  }

  it('devuelve las huellas de los dispositivos vinculados al cliente, sin vacías', async () => {
    const { repository, deviceModel } = build(
      [{ deviceId: '5' }, { deviceId: null }, { deviceId: '6' }],
      [{ deviceFingerprint: 'fp-a' }, { deviceFingerprint: null }, { deviceFingerprint: 'fp-b' }],
    );
    expect(await repository.fingerprintsOfCustomer('t1', '10')).toEqual(['fp-a', 'fp-b']);
    expect(JSON.stringify((deviceModel.findAll.mock.calls[0] as unknown[])[0])).toContain('"tenantId":"t1"');
  });

  it('un cliente sin dispositivos vinculados no consulta la tabla de dispositivos', async () => {
    const { repository, deviceModel } = build([], []);
    expect(await repository.fingerprintsOfCustomer('t1', '10')).toEqual([]);
    expect(deviceModel.findAll).not.toHaveBeenCalled();
  });
});
