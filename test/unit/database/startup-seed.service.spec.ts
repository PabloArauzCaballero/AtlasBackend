import { describe, expect, it, jest, beforeEach } from '@jest/globals';

/**
 * Seeding idempotente al arrancar (opt-in). El servicio debe ser no-op cuando la var está apagada,
 * llamar al runner cuando está encendida, y respetar FAIL_FAST ante un fallo de seed.
 */

// env es un const importado; se mockea con un objeto mutable para variar la config por test.
const mockEnv: { DATABASE_SEED_ON_STARTUP: boolean; DATABASE_SEED_ON_STARTUP_FAIL_FAST: boolean } = {
  DATABASE_SEED_ON_STARTUP: false,
  DATABASE_SEED_ON_STARTUP_FAIL_FAST: false,
};
jest.mock('../../../src/config/env.js', () => ({ env: mockEnv }));

const mockSeedOnStartup = jest.fn(async (..._args: unknown[]) => ({ profile: 'development', appliedByStage: {}, totalApplied: 0 }));
jest.mock('../../../src/database/seed-runner.js', () => ({ seedOnStartup: () => mockSeedOnStartup() }));

import { StartupSeedService } from '../../../src/database/startup-seed.service.js';

describe('StartupSeedService.onApplicationBootstrap', () => {
  beforeEach(() => {
    mockSeedOnStartup.mockClear();
    mockEnv.DATABASE_SEED_ON_STARTUP = false;
    mockEnv.DATABASE_SEED_ON_STARTUP_FAIL_FAST = false;
  });

  it('es no-op cuando DATABASE_SEED_ON_STARTUP=false', async () => {
    await new StartupSeedService().onApplicationBootstrap();
    expect(mockSeedOnStartup).not.toHaveBeenCalled();
  });

  it('corre el seeding cuando DATABASE_SEED_ON_STARTUP=true', async () => {
    mockEnv.DATABASE_SEED_ON_STARTUP = true;
    await new StartupSeedService().onApplicationBootstrap();
    expect(mockSeedOnStartup).toHaveBeenCalledTimes(1);
  });

  it('un fallo de seed NO tumba el arranque por defecto (FAIL_FAST=false)', async () => {
    mockEnv.DATABASE_SEED_ON_STARTUP = true;
    mockSeedOnStartup.mockRejectedValueOnce(new Error('boom') as never);
    await expect(new StartupSeedService().onApplicationBootstrap()).resolves.toBeUndefined();
  });

  it('con FAIL_FAST=true, un fallo de seed aborta el arranque (propaga el error)', async () => {
    mockEnv.DATABASE_SEED_ON_STARTUP = true;
    mockEnv.DATABASE_SEED_ON_STARTUP_FAIL_FAST = true;
    mockSeedOnStartup.mockRejectedValueOnce(new Error('boom') as never);
    await expect(new StartupSeedService().onApplicationBootstrap()).rejects.toThrow('boom');
  });
});
