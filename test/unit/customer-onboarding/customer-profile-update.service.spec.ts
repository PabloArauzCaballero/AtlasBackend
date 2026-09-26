/**
 * @file Verifica que un dato ya verificado por CUALQUIER canal no se pueda reescribir por autoservicio.
 * @business Reabrir nombre/apellido/fecha de nacimiento tras verificar la identidad es el hueco por el que se cuela una suplantación.
 * @system Ejercita `assertIdentityFieldsEditable` (privado) a través de `CustomerProfileUpdateService.updateProfile`.
 */
import { describe, expect, it, jest } from '@jest/globals';
import { CustomerProfileUpdateService } from '../../../src/modules/customer-onboarding/application/customer-profile-update.service.js';
import type { AuthenticatedUser } from '../../../src/common/types/auth.types.js';

const CUSTOMER_ID = '10';
const TENANT_ID = '7';

const CURRENT_USER: AuthenticatedUser = {
  role: 'customer',
  customerId: CUSTOMER_ID,
} as AuthenticatedUser;

function build(identityVerificationResult: string | null) {
  const customersRepository = {
    findById: jest.fn(async () => ({ lifecycleStatus: 'active' })),
  };
  const eligibilityRepository = {
    loadFacts: jest.fn(async () => ({ identityVerificationResult })),
  };
  // El resto de dependencias no se llega a tocar cuando la guarda de identidad frena antes de la
  // transacción: si el test las alcanzara con estos dobles vacíos, fallaría igual, y eso es lo que
  // demuestra que la guarda corta ANTES.
  const service = new CustomerProfileUpdateService(
    customersRepository as never,
    {} as never,
    {} as never,
    {} as never,
    eligibilityRepository as never,
    {} as never,
    {} as never,
  );
  return { service, customersRepository, eligibilityRepository };
}

describe('CustomerProfileUpdateService · campos de identidad congelados', () => {
  it('FALLA sin el fix: un VERIFIED en mayúsculas (canal móvil) hoy NO bloquea la edición del nombre (I-1)', async () => {
    // Antes, `facts.identityVerificationResult !== IDENTITY_VERIFIED_RESULT` (comparación estricta
    // contra 'verified' en minúsculas) dejaba pasar la edición de un cliente verificado por el
    // Motor, que escribe `VERIFIED`: el veredicto quedaba sin proteger contra una suplantación.
    const { service } = build('VERIFIED');

    await expect(
      service.updateProfile({
        tenantId: TENANT_ID,
        customerId: CUSTOMER_ID,
        body: { firstName: 'Otro Nombre' },
        currentUser: CURRENT_USER,
        ipAddress: null,
      }),
    ).rejects.toThrow(/IDENTITY_FIELDS_LOCKED/);
  });

  it('sigue bloqueando cuando el veredicto está en minúsculas (canal directo)', async () => {
    const { service } = build('verified');

    await expect(
      service.updateProfile({
        tenantId: TENANT_ID,
        customerId: CUSTOMER_ID,
        body: { lastName: 'Otro Apellido' },
        currentUser: CURRENT_USER,
        ipAddress: null,
      }),
    ).rejects.toThrow(/IDENTITY_FIELDS_LOCKED/);
  });

  it('no bloquea campos de identidad cuando todavía no hay veredicto', async () => {
    const { service, eligibilityRepository } = build('pending_review');

    // Los dobles vacíos (sequelize, repos) hacen que el flujo falle MÁS ADELANTE, en la
    // transacción: lo que importa aquí es que la guarda de identidad NO frenó antes de llegar ahí.
    let error: unknown;
    try {
      await service.updateProfile({
        tenantId: TENANT_ID,
        customerId: CUSTOMER_ID,
        body: { firstName: 'Nombre Nuevo' },
        currentUser: CURRENT_USER,
        ipAddress: null,
      });
    } catch (caught) {
      error = caught;
    }

    expect(eligibilityRepository.loadFacts).toHaveBeenCalled();
    expect(String(error)).not.toContain('IDENTITY_FIELDS_LOCKED');
  });
});
