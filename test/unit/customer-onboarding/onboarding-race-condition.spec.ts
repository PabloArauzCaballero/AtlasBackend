import { describe, expect, it, jest } from '@jest/globals';
import { ConflictException } from '@nestjs/common';
import { UniqueConstraintError } from 'sequelize';
import { CustomerOnboardingStartService } from '../../../src/modules/customer-onboarding/application/customer-onboarding-start.service.js';
import { CustomerOnboardingService } from '../../../src/modules/customer-onboarding/customer-onboarding.service.js';

/**
 * Regresión de concurrencia: `startOnboarding` protege contra clientes duplicados con índices
 * únicos parciales, no solo con el `SELECT` previo. Este test simula exactamente ese escenario: el chequeo previo
 * "no encuentra nada" (como pasaría en una carrera real, donde ambos requests llegan casi al
 * mismo tiempo), pero el índice único de base de datos SÍ detecta la colisión al momento de
 * escribir, y el servicio debe traducir ese error de base de datos al mismo error de negocio
 * que el chequeo previo (`CUSTOMER_ALREADY_EXISTS`), no dejarlo escapar como un 500 genérico.
 */
describe('CustomerOnboardingService — condición de carrera en alta de cliente', () => {
  function buildService(overrides: { createCustomerImpl: () => Promise<never> }) {
    const customersRepository = {
      findByContactHash: jest.fn().mockResolvedValue(null), // "no encontrado" — como en una carrera real
      createCustomer: jest.fn(overrides.createCustomerImpl),
    };
    const sessionsRepository = {};
    const consentsRepository = {
      findActiveDocumentById: jest.fn().mockResolvedValue({ id: '1' }),
    };
    const onboardingRepository = {};
    const authRepository = {
      createCredentials: jest.fn(),
    };
    const sequelize = {
      transaction: jest.fn((callback: (t: unknown) => Promise<unknown>) => callback({})),
    };

    const startService = new CustomerOnboardingStartService(
      customersRepository as never,
      sessionsRepository as never,
      consentsRepository as never,
      onboardingRepository as never,
      authRepository as never,
      sequelize as never,
    );

    const service = new CustomerOnboardingService(startService, {} as never, {} as never, {} as never);

    return { service, customersRepository, sequelize };
  }

  const baseInput = {
    customer: { phone: '+59170000000', email: 'race-condition@atlas.test' },
    consents: [{ consentDocumentId: '1', purposeCode: 'onboarding', granted: true }],
    device: { deviceFingerprintHash: 'a'.repeat(32), fingerprintVersion: 'v1', channel: 'mobile_app' as const },
  };

  it('translates a UniqueConstraintError raised inside the transaction into CUSTOMER_ALREADY_EXISTS', async () => {
    const { service, sequelize } = buildService({
      createCustomerImpl: async () => {
        throw new UniqueConstraintError({ message: 'ux_customers_tenant_email_hash violated' });
      },
    });

    await expect(service.startOnboarding('1', baseInput as never, null, 'idem-key-1')).rejects.toThrow(ConflictException);

    // La transacción efectivamente se abrió (no se evitó el intento de escritura) — la
    // protección real vino de traducir el error de base de datos, no de saltarse el intento.
    expect(sequelize.transaction).toHaveBeenCalledTimes(1);
  });

  it('re-throws non-UniqueConstraintError errors unchanged (does not mask unrelated failures)', async () => {
    const genericError = new Error('conexión a base de datos perdida');
    const { service } = buildService({
      createCustomerImpl: async () => {
        throw genericError;
      },
    });

    await expect(service.startOnboarding('1', baseInput as never, null, 'idem-key-2')).rejects.toBe(genericError);
  });
});
