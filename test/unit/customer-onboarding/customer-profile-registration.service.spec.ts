import { describe, expect, it, jest } from '@jest/globals';
import { NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { CustomerFinancialProfileService } from '../../../src/modules/customer-onboarding/application/customer-financial-profile.service.js';
import { CustomerProfileUpdateService } from '../../../src/modules/customer-onboarding/application/customer-profile-update.service.js';

/**
 * Registro progresivo del cliente: datos personales y perfil económico.
 *
 * Ninguno de los dos existía. Nombre, apellido y fecha de nacimiento solo podían enviarse
 * —opcionalmente— en el registro, sin forma posterior de completarlos ni corregirlos; y
 * `customer_attribute_values` / `attribute_definitions` estaban migradas desde el arranque del
 * proyecto con CERO referencias en el código: el modelo de datos económicos existía, el camino de
 * escritura no.
 */
const customerUser = { role: 'customer', customerId: 'c1', internalUserId: null } as never;

function commonMocks() {
  const customersRepository = {
    findById: jest.fn(async (..._args: unknown[]) => ({ id: 'c1', lifecycleStatus: 'onboarding_in_progress' })),
    updateCurrentProfileVersion: jest.fn(),
  };
  const onboardingRepository = {
    findLatestOnboardingFlow: jest.fn(async (..._args: unknown[]) => ({ id: 'flow-1' })),
    createOnboardingStepEvent: jest.fn(),
    createOperationalAuditLog: jest.fn(),
  };
  const lifecycleService = { advance: jest.fn(), transition: jest.fn() };
  const sequelize = { transaction: jest.fn(async (cb: (t: unknown) => Promise<unknown>) => cb({})) };
  return { customersRepository, onboardingRepository, lifecycleService, sequelize };
}

describe('CustomerProfileUpdateService', () => {
  function build() {
    const common = commonMocks();
    const profileDataRepository = {
      findCurrentProfile: jest.fn(async (..._args: unknown[]) => null),
      closeProfileVersion: jest.fn(),
      createProfileVersion: jest.fn(async (..._args: unknown[]) => ({
        id: 'profile-2',
        firstName: 'Ana',
        lastName: 'Paz',
        birthDate: '1990-01-01',
        supersedesVersionId: null,
      })),
    };
    const service = new CustomerProfileUpdateService(
      common.customersRepository as never,
      profileDataRepository as never,
      common.onboardingRepository as never,
      common.lifecycleService as never,
      common.sequelize as never,
    );
    return { service, profileDataRepository, ...common };
  }

  const baseInput = { tenantId: 't1', customerId: 'c1', currentUser: customerUser, ipAddress: '10.0.0.1' };

  it('lanza NotFoundException cuando el cliente no existe', async () => {
    const { service, customersRepository } = build();
    (customersRepository.findById as jest.Mock).mockResolvedValueOnce(null as never);
    await expect(service.updateProfile({ ...baseInput, body: { firstName: 'Ana' } as never })).rejects.toThrow(NotFoundException);
  });

  it('bloquea la edición cuando el estado del cliente ya no la admite', async () => {
    const { service, customersRepository } = build();
    (customersRepository.findById as jest.Mock).mockResolvedValueOnce({ id: 'c1', lifecycleStatus: 'under_review' } as never);
    await expect(service.updateProfile({ ...baseInput, body: { firstName: 'Ana' } as never })).rejects.toThrow(
      /PROFILE_NOT_EDITABLE_IN_STATUS: under_review/,
    );
  });

  it('crea una versión NUEVA del perfil y cierra la anterior en vez de sobrescribirla', async () => {
    const { service, profileDataRepository } = build();
    const current = {
      id: 'profile-1',
      firstName: 'Ana',
      lastName: null,
      birthDate: null,
      genderDeclared: null,
      preferredLanguage: 'es',
      marketingOptIn: false,
    };
    (profileDataRepository.findCurrentProfile as jest.Mock).mockResolvedValueOnce(current as never);

    await service.updateProfile({ ...baseInput, body: { lastName: 'Paz' } as never });

    expect(profileDataRepository.closeProfileVersion).toHaveBeenCalledWith(current, expect.any(Date), { transaction: {} });
    const created = (profileDataRepository.createProfileVersion as jest.Mock).mock.calls[0][0] as Record<string, unknown>;
    // El campo no enviado conserva su valor anterior: el guardado es parcial, no destructivo.
    expect(created).toMatchObject({ firstName: 'Ana', lastName: 'Paz', supersedesVersionId: 'profile-1' });
  });

  it('deriva el nombre normalizado y la edad al capturar la fecha de nacimiento', async () => {
    const { service, profileDataRepository } = build();
    await service.updateProfile({ ...baseInput, body: { firstName: 'Ana', lastName: 'Paz', birthDate: '1990-01-01' } as never });
    const created = (profileDataRepository.createProfileVersion as jest.Mock).mock.calls[0][0] as Record<string, unknown>;
    expect(created.fullNameNormalized).toBe('ana paz');
    expect(created.ageAtCapture).toBeGreaterThan(18);
  });

  it('empuja el estado hacia onboarding_in_progress sin romper si la transición no aplica', async () => {
    const { service, lifecycleService } = build();
    await service.updateProfile({ ...baseInput, body: { firstName: 'Ana' } as never });
    expect(lifecycleService.advance).toHaveBeenCalledWith(
      expect.objectContaining({ toStatus: 'onboarding_in_progress', reasonCode: 'personal_data_updated' }),
    );
  });
});

describe('CustomerFinancialProfileService', () => {
  const DEFINITIONS = [
    { id: 'def-1', attributeCode: 'employment_status' },
    { id: 'def-2', attributeCode: 'monthly_income_declared' },
  ];

  function build() {
    const common = commonMocks();
    const profileDataRepository = {
      findAttributeDefinitionsByCode: jest.fn(async (..._args: unknown[]) => DEFINITIONS),
      findCurrentAttributeValues: jest.fn(async (..._args: unknown[]) => []),
      closeAttributeValue: jest.fn(),
      createAttributeValue: jest.fn(),
    };
    const service = new CustomerFinancialProfileService(
      common.customersRepository as never,
      profileDataRepository as never,
      common.onboardingRepository as never,
      common.lifecycleService as never,
      common.sequelize as never,
    );
    return { service, profileDataRepository, ...common };
  }

  const baseInput = { tenantId: 't1', customerId: 'c1', currentUser: customerUser, ipAddress: '10.0.0.1' };

  it('falla explícitamente si el catálogo de atributos no está sembrado', async () => {
    const { service, profileDataRepository } = build();
    (profileDataRepository.findAttributeDefinitionsByCode as jest.Mock).mockResolvedValueOnce([] as never);
    await expect(
      service.upsertFinancialProfile({ ...baseInput, body: { employmentStatus: 'employee', employerName: 'ACME' } as never }),
    ).rejects.toThrow(/ATTRIBUTE_CATALOG_NOT_SEEDED/);
  });

  it('bloquea la edición cuando el estado del cliente ya no la admite', async () => {
    const { service, customersRepository } = build();
    (customersRepository.findById as jest.Mock).mockResolvedValueOnce({ id: 'c1', lifecycleStatus: 'active' } as never);
    await expect(service.upsertFinancialProfile({ ...baseInput, body: { employmentStatus: 'retired' } as never })).rejects.toThrow(
      UnprocessableEntityException,
    );
  });

  it('escribe los valores numéricos y de texto en la columna correcta de la tabla EAV', async () => {
    const { service, profileDataRepository } = build();

    const result = await service.upsertFinancialProfile({
      ...baseInput,
      body: { employmentStatus: 'self_employed', monthlyIncomeDeclared: 4500 } as never,
    });

    const writes = (profileDataRepository.createAttributeValue as jest.Mock).mock.calls.map((call) => call[0] as Record<string, unknown>);
    expect(writes).toEqual([
      expect.objectContaining({ attributeDefinitionId: 'def-1', valueText: 'self_employed', valueNumber: null }),
      expect.objectContaining({ attributeDefinitionId: 'def-2', valueText: null, valueNumber: '4500.0000' }),
    ]);
    expect(writes.every((write) => write.sourceType === 'customer_declared' && write.verificationStatus === 'declared')).toBe(true);
    expect(result.updatedAttributes).toEqual(['employment_status', 'monthly_income_declared']);
  });

  it('cierra la vigencia del valor anterior en vez de sobrescribirlo (tabla append-only)', async () => {
    const { service, profileDataRepository } = build();
    const previous = { id: 'val-1', attributeDefinitionId: 'def-1' };
    (profileDataRepository.findCurrentAttributeValues as jest.Mock).mockResolvedValueOnce([previous] as never);

    await service.upsertFinancialProfile({ ...baseInput, body: { employmentStatus: 'self_employed' } as never });

    expect(profileDataRepository.closeAttributeValue).toHaveBeenCalledWith(previous, expect.any(Date), { transaction: {} });
  });

  it('la auditoría registra solo los CÓDIGOS de atributo, nunca los importes declarados', async () => {
    const { service, onboardingRepository } = build();
    await service.upsertFinancialProfile({ ...baseInput, body: { monthlyIncomeDeclared: 4500 } as never });
    const auditPayload = JSON.stringify((onboardingRepository.createOperationalAuditLog as jest.Mock).mock.calls[0][0]);
    expect(auditPayload).toContain('monthly_income_declared');
    expect(auditPayload).not.toContain('4500');
  });
});
