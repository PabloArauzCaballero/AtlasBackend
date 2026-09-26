/**
 * @file El intento del canal de alta que se le presenta al Motor es el VIGENTE, no el último a secas.
 * @business Reenviar el paquete de identidad crea un intento nuevo en revisión. Si ése tapa el `verified`
 *   que el registro estatal ya había dado, el artefacto de identidad recibe «pendiente» y manda a una
 *   persona lo que ya estaba resuelto.
 * @system Ejercita `MobileIdentityRepository.findLatestOnboardingAttempt` y su traducción en
 *   `MobileIdentitySignalsService.estadoDelRegistroEstatal`.
 */
import { describe, expect, it, jest } from '@jest/globals';
import { Op } from 'sequelize';
import { MOBILE_CHANNEL, MobileIdentityRepository } from '../../../src/modules/mobile-identity/mobile-identity.repository.js';
import { MobileIdentitySignalsService } from '../../../src/modules/mobile-identity/mobile-identity-signals.service.js';

function repositoryWith(rowsNewestFirst: Array<{ finalResult: string | null }>) {
  const model = { findAll: jest.fn(async (..._args: unknown[]) => rowsNewestFirst) };
  return { repository: new MobileIdentityRepository(model as never), model };
}

describe('MobileIdentityRepository.findLatestOnboardingAttempt', () => {
  it('FALLA sin el fix: un paquete reenviado en revisión no tapa el verified del registro estatal (I-2)', async () => {
    const { repository } = repositoryWith([{ finalResult: 'pending_review' }, { finalResult: 'verified' }]);

    await expect(repository.findLatestOnboardingAttempt('7', '10')).resolves.toEqual({ finalResult: 'verified' });
  });

  it('lee sólo el canal de alta, del más reciente al más antiguo', async () => {
    const { repository, model } = repositoryWith([{ finalResult: 'verified' }]);

    await repository.findLatestOnboardingAttempt('7', '10');

    const options = model.findAll.mock.calls[0][0] as { where: Record<string, unknown>; order: unknown };
    expect(options.where).toEqual({ tenantId: '7', customerId: '10', verificationChannel: { [Op.ne]: MOBILE_CHANNEL } });
    expect(options.order).toEqual([['_id', 'DESC']]);
  });

  it('sin veredicto en ninguno, manda el más reciente', async () => {
    const { repository } = repositoryWith([{ finalResult: 'pending_review' }, { finalResult: 'pending_review' }]);
    await expect(repository.findLatestOnboardingAttempt('7', '10')).resolves.toEqual({ finalResult: 'pending_review' });
  });

  it('un cliente sin intentos de alta no tiene ninguno', async () => {
    const { repository } = repositoryWith([]);
    await expect(repository.findLatestOnboardingAttempt('7', '10')).resolves.toBeNull();
  });
});

describe('MobileIdentitySignalsService.estadoDelRegistroEstatal', () => {
  function signalsWith(finalResult: string | null | undefined) {
    const repository = {
      findLatestOnboardingAttempt: jest.fn(async (..._args: unknown[]) => (finalResult === undefined ? null : { finalResult })),
    };
    return new MobileIdentitySignalsService(repository as never, {} as never, {} as never, {} as never, {} as never);
  }

  it.each([
    ['verified', { estado: 'FOUND', coincidencia: 1 }],
    ['VERIFIED', { estado: 'FOUND', coincidencia: 1 }],
    ['rejected', { estado: 'NOT_FOUND', coincidencia: 0 }],
    ['REJECTED', { estado: 'NOT_FOUND', coincidencia: 0 }],
    ['pending_review', { estado: 'PENDING', coincidencia: 0 }],
    [null, { estado: 'PENDING', coincidencia: 0 }],
  ])('traduce %s al vocabulario del proveedor', async (finalResult, esperado) => {
    await expect(signalsWith(finalResult).estadoDelRegistroEstatal('7', '10')).resolves.toEqual(esperado);
  });

  it('sin intento de alta no se consultó nada', async () => {
    await expect(signalsWith(undefined).estadoDelRegistroEstatal('7', '10')).resolves.toEqual({ estado: 'NO_CONSULTADO', coincidencia: 0 });
  });
});
