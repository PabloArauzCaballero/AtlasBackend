import { describe, expect, it, jest } from '@jest/globals';
import {
  ONBOARDING_STRIKE_LIMIT,
  ONBOARDING_STRIKE_WINDOW_SECONDS,
  OnboardingStrikeService,
} from '../../../src/modules/customer-onboarding/application/onboarding-strike.service.js';

/** Equivocarse con un dato ya registrado no bloquea; reincidir con datos DISTINTOS sí (Pablo, 2026-10-19). */
describe('OnboardingStrikeService', () => {
  const ipBlock = () => ({
    block: jest.fn(async (..._a: unknown[]) => undefined),
    blockDevice: jest.fn(async (..._a: unknown[]) => undefined),
  });

  it('cuenta datos distintos, no peticiones: repetir el mismo no suma', async () => {
    const service = new OnboardingStrikeService(null, ipBlock() as never);
    expect(await service.record(['ip:1.1.1.1'], 'a')).toBe(1);
    expect(await service.record(['ip:1.1.1.1'], 'a')).toBe(1);
    expect(await service.record(['ip:1.1.1.1'], 'b')).toBe(2);
  });

  it('devuelve el mayor conteo de los sujetos y salta los vacíos', async () => {
    const service = new OnboardingStrikeService(null, ipBlock() as never);
    await service.record(['ip:1.1.1.1'], 'a');
    await service.record(['ip:1.1.1.1'], 'b');
    expect(await service.record(['ip:2.2.2.2', null, undefined, 'ip:1.1.1.1'], 'c')).toBe(3);
  });

  it('con Redis usa un conjunto con caducidad y toma el conteo del servidor', async () => {
    const chain = {
      sadd: jest.fn((..._a: unknown[]) => chain),
      expire: jest.fn((..._a: unknown[]) => chain),
      scard: jest.fn((..._a: unknown[]) => chain),
      exec: jest.fn(async () => [
        [null, 1],
        [null, 1],
        [null, 4],
      ]),
    };
    const redis = { multi: jest.fn(() => chain) };
    const service = new OnboardingStrikeService(redis as never, ipBlock() as never);
    expect(await service.record(['ip:1.1.1.1'], 'a')).toBe(4);
    expect(chain.sadd).toHaveBeenCalledWith('atlas:onboarding:strikes:ip:1.1.1.1', 'a');
    expect(chain.expire).toHaveBeenCalledWith('atlas:onboarding:strikes:ip:1.1.1.1', ONBOARDING_STRIKE_WINDOW_SECONDS);
  });

  it('si Redis falla cuenta en memoria y no lanza', async () => {
    const redis = {
      multi: jest.fn(() => {
        throw new Error('caído');
      }),
    };
    const service = new OnboardingStrikeService(redis as never, ipBlock() as never);
    expect(await service.record(['ip:1.1.1.1'], 'a')).toBe(1);
  });

  describe('registerExistingContact (arranque del alta)', () => {
    const base = { ipAddress: '200.1.2.3', fingerprint: 'fp-1' };

    it('los primeros correos ya registrados no bloquean', async () => {
      const blocks = ipBlock();
      const service = new OnboardingStrikeService(null, blocks as never);
      for (let i = 1; i < ONBOARDING_STRIKE_LIMIT; i += 1)
        expect(await service.registerExistingContact({ ...base, valueHash: `m${i}` })).toBe(false);
      expect(blocks.block).not.toHaveBeenCalled();
    });

    it('el tercero distinto bloquea la IP y el dispositivo', async () => {
      const blocks = ipBlock();
      const service = new OnboardingStrikeService(null, blocks as never);
      await service.registerExistingContact({ ...base, valueHash: 'm1' });
      await service.registerExistingContact({ ...base, valueHash: 'm2' });
      expect(await service.registerExistingContact({ ...base, valueHash: 'm3' })).toBe(true);
      expect(blocks.block).toHaveBeenCalledWith('200.1.2.3', 'REPEATED_EXISTING_DATA');
      expect(blocks.blockDevice).toHaveBeenCalledWith('fp-1', 'REPEATED_EXISTING_DATA');
    });

    it('insistir con el MISMO correo no bloquea nunca', async () => {
      const blocks = ipBlock();
      const service = new OnboardingStrikeService(null, blocks as never);
      for (let i = 0; i < 10; i += 1) expect(await service.registerExistingContact({ ...base, valueHash: 'mismo' })).toBe(false);
      expect(blocks.block).not.toHaveBeenCalled();
    });
  });
});
