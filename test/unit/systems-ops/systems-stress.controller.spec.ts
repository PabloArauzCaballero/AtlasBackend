import { describe, expect, it, jest } from '@jest/globals';
import { SystemsStressController } from '../../../src/modules/systems-ops/systems-stress.controller.js';

/**
 * `SystemsStressController` reparte entre `SystemsStressProfileService` (perfiles/matriz) y
 * `SystemsStressRunService` (encolar/listar corridas). Spec directo que verifica ese ruteo.
 */
describe('SystemsStressController', () => {
  function build() {
    const profileService = {
      listStressProfiles: jest.fn(async () => ({ items: [] })),
      getStressProfile: jest.fn(async () => ({ profileId: '5' })),
      upsertStressProfile: jest.fn(async () => ({ profileId: '5' })),
      getStressMatrix: jest.fn(async () => ({ items: [] })),
    };
    const stressRunService = {
      queueStressRun: jest.fn(async () => ({ queued: true })),
      listStressRuns: jest.fn(async () => ({ items: [] })),
    };
    return { controller: new SystemsStressController(profileService as never, stressRunService as never), profileService, stressRunService };
  }
  const user = { role: 'system_admin', tenantId: '1', internalUserId: 'u1' } as never;

  it('listStressProfiles/getStressProfile/upsert/getStressMatrix van al profile service', async () => {
    const { controller, profileService } = build();
    await controller.listStressProfiles({ status: 'ACTIVE' } as never);
    await controller.getStressProfile({ profileId: '5' } as never);
    const body = { endpointId: '9' } as never;
    await controller.upsertStressProfile(body, user);
    await controller.getStressMatrix({ module: 'auth' } as never);
    expect(profileService.listStressProfiles).toHaveBeenCalledWith({ status: 'ACTIVE' });
    expect(profileService.getStressProfile).toHaveBeenCalledWith('5');
    expect(profileService.upsertStressProfile).toHaveBeenCalledWith(body, user);
    expect(profileService.getStressMatrix).toHaveBeenCalledWith({ module: 'auth' });
  });

  it('queueStressRun y listStressRuns van al stress-run service', async () => {
    const { controller, stressRunService, profileService } = build();
    const body = { environment: 'TEST', dryRun: true } as never;
    await controller.queueStressRun({ profileId: '5' } as never, body, user);
    await controller.listStressRuns({ status: 'queued' } as never, user);
    expect(stressRunService.queueStressRun).toHaveBeenCalledWith('5', body, user);
    expect(stressRunService.listStressRuns).toHaveBeenCalledWith({ status: 'queued' }, user);
    // no se mezclan los servicios
    expect((profileService as { queueStressRun?: unknown }).queueStressRun).toBeUndefined();
  });
});
