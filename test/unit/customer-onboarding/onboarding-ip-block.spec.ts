import { describe, expect, it, jest } from '@jest/globals';
import { ForbiddenException } from '@nestjs/common';
import {
  OnboardingIpBlockService,
  ONBOARDING_DEVICE_BLOCK_TTL_SECONDS,
  ONBOARDING_IP_BLOCK_TTL_SECONDS,
} from '../../../src/modules/customer-onboarding/application/onboarding-ip-block.service.js';
import { OnboardingIpBlockGuard } from '../../../src/modules/customer-onboarding/onboarding-ip-block.guard.js';

describe('OnboardingIpBlockService', () => {
  it('guarda el bloqueo en Redis con caducidad y lo recuerda', async () => {
    const redis = { set: jest.fn(async (..._a: unknown[]) => 'OK'), exists: jest.fn(async (..._a: unknown[]) => 1) };
    const service = new OnboardingIpBlockService(redis as never);
    await service.block('200.1.2.3', 'IDENTITY_DOCUMENT_ALREADY_REGISTERED');
    expect(redis.set).toHaveBeenCalledWith(
      'atlas:onboarding:ip-block:200.1.2.3',
      'IDENTITY_DOCUMENT_ALREADY_REGISTERED',
      'EX',
      ONBOARDING_IP_BLOCK_TTL_SECONDS,
    );
    expect(await service.isBlocked('200.1.2.3')).toBe(true);
  });

  it('otro proceso lo ve por Redis aunque su memoria esté vacía', async () => {
    const redis = { set: jest.fn(), exists: jest.fn(async (..._a: unknown[]) => 1) };
    expect(await new OnboardingIpBlockService(redis as never).isBlocked('200.1.2.3')).toBe(true);
  });

  it('una IP sin bloqueo pasa; sin IP también', async () => {
    const redis = { set: jest.fn(), exists: jest.fn(async (..._a: unknown[]) => 0) };
    const service = new OnboardingIpBlockService(redis as never);
    expect(await service.isBlocked('200.1.2.3')).toBe(false);
    expect(await service.isBlocked(undefined)).toBe(false);
  });

  it('sin Redis bloquea en memoria del proceso', async () => {
    const service = new OnboardingIpBlockService(null);
    await service.block('200.1.2.3', 'IDENTITY_DOCUMENT_ALREADY_REGISTERED');
    expect(await service.isBlocked('200.1.2.3')).toBe(true);
    expect(await service.isBlocked('200.9.9.9')).toBe(false);
  });

  it('si Redis falla al guardar, el bloqueo sigue vigente en memoria; si falla al leer, deja pasar', async () => {
    const redis = {
      set: jest.fn(async (..._a: unknown[]) => {
        throw new Error('caído');
      }),
      exists: jest.fn(async (..._a: unknown[]) => {
        throw new Error('caído');
      }),
    };
    const service = new OnboardingIpBlockService(redis as never);
    await service.block('200.1.2.3', 'IDENTITY_DOCUMENT_ALREADY_REGISTERED');
    expect(await service.isBlocked('200.1.2.3')).toBe(true);
    expect(await service.isBlocked('200.7.7.7')).toBe(false);
  });
});

describe('OnboardingIpBlockService · dispositivo', () => {
  it('guarda la huella del teléfono con caducidad más larga que la de la IP, y es independiente de ella', async () => {
    const redis = { set: jest.fn(async (..._a: unknown[]) => 'OK'), exists: jest.fn(async (..._a: unknown[]) => 0) };
    const service = new OnboardingIpBlockService(redis as never);
    await service.blockDevice('fp-1', 'IDENTITY_DOCUMENT_ALREADY_REGISTERED');
    expect(redis.set).toHaveBeenCalledWith(
      'atlas:onboarding:device-block:fp-1',
      'IDENTITY_DOCUMENT_ALREADY_REGISTERED',
      'EX',
      ONBOARDING_DEVICE_BLOCK_TTL_SECONDS,
    );
    expect(ONBOARDING_DEVICE_BLOCK_TTL_SECONDS).toBeGreaterThan(ONBOARDING_IP_BLOCK_TTL_SECONDS);
    expect(await service.isDeviceBlocked('fp-1')).toBe(true);
    expect(await service.isDeviceBlocked('fp-2')).toBe(false);
    expect(await service.isBlocked('fp-1')).toBe(false);
  });

  it('otro proceso ve el bloqueo del dispositivo por Redis, y sin huella no bloquea ni consulta', async () => {
    const redis = { set: jest.fn(), exists: jest.fn(async (..._a: unknown[]) => 1) };
    const service = new OnboardingIpBlockService(redis as never);
    expect(await service.isDeviceBlocked('fp-1')).toBe(true);
    await service.blockDevice(undefined, 'IDENTITY_DOCUMENT_ALREADY_REGISTERED');
    expect(redis.set).not.toHaveBeenCalled();
    expect(await service.isDeviceBlocked(null)).toBe(false);
  });
});

describe('OnboardingIpBlockGuard', () => {
  const contextFor = (ip: string | undefined) => ({ switchToHttp: () => ({ getRequest: () => ({ ip }) }) }) as never;

  it('corta con 403 ONBOARDING_IP_BLOCKED a una IP bloqueada', async () => {
    const guard = new OnboardingIpBlockGuard({ isBlocked: jest.fn(async (..._a: unknown[]) => true) } as never);
    const result = guard.canActivate(contextFor('200.1.2.3'));
    await expect(result).rejects.toThrow(ForbiddenException);
    await expect(result).rejects.toThrow('ONBOARDING_IP_BLOCKED');
  });

  it('deja pasar a una IP sin bloqueo', async () => {
    const guard = new OnboardingIpBlockGuard({ isBlocked: jest.fn(async (..._a: unknown[]) => false) } as never);
    expect(await guard.canActivate(contextFor('200.1.2.3'))).toBe(true);
  });
});
