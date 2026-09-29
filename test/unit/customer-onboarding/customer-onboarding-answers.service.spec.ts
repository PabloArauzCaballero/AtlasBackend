/**
 * @file Lo ya contestado en el alta vuelve tal como se guardó, para rellenar cada paso al volver.
 * @business Volver atrás en el alta no puede enseñar un formulario vacío ni un criptograma en la calle.
 * @system Ejercita `CustomerOnboardingAnswersService` (GET /customer-onboarding/:id/answers) con repositorios dobles.
 */
import { describe, expect, it, jest } from '@jest/globals';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { encryptSecretEnvelope } from '../../../src/common/utils/crypto/envelope-encryption.util.js';
import { CustomerOnboardingAnswersService } from '../../../src/modules/customer-onboarding/application/customer-onboarding-answers.service.js';

const cliente = { role: 'customer', customerId: 'c1', internalUserId: null } as never;
const operador = { role: 'internal_operator', customerId: null, internalUserId: '9' } as never;

function build(opciones: { customer?: unknown; profile?: unknown; values?: unknown[]; version?: unknown; gps?: unknown } = {}) {
  const customersRepository = {
    findById: jest.fn(async (..._args: unknown[]) => ('customer' in opciones ? opciones.customer : { id: 'c1' })),
  };
  const profileDataRepository = {
    findCurrentProfile: jest.fn(async (..._args: unknown[]) => opciones.profile ?? null),
    findAttributeDefinitionsByCode: jest.fn(async (..._args: unknown[]) => [
      { id: 1, attributeCode: 'employment_status' },
      { id: 2, attributeCode: 'monthly_income_declared' },
      { id: 3, attributeCode: 'monthly_income_band' },
      { id: 4, attributeCode: 'employment_seniority_months' },
      { id: 5, attributeCode: 'codigo_que_no_es_del_formulario' },
    ]),
    findCurrentAttributeValues: jest.fn(async (..._args: unknown[]) => opciones.values ?? []),
  };
  const answersRepository = {
    findCurrentHomeAddressVersion: jest.fn(async (..._args: unknown[]) => opciones.version ?? null),
    findLatestGpsForAddressVersion: jest.fn(async (..._args: unknown[]) => opciones.gps ?? null),
  };
  const service = new CustomerOnboardingAnswersService(
    customersRepository as never,
    profileDataRepository as never,
    answersRepository as never,
  );
  return { service, customersRepository, profileDataRepository, answersRepository };
}

describe('CustomerOnboardingAnswersService', () => {
  it('un cliente sólo ve lo suyo: pedir las respuestas de otro es 403 y no lee nada', async () => {
    const { service, customersRepository } = build();

    await expect(service.getAnswers({ tenantId: 't1', customerId: 'c2', currentUser: cliente })).rejects.toBeInstanceOf(ForbiddenException);
    expect(customersRepository.findById).not.toHaveBeenCalled();
  });

  it('un cliente inexistente es 404', async () => {
    const { service } = build({ customer: null });

    await expect(service.getAnswers({ tenantId: 't1', customerId: 'c1', currentUser: operador })).rejects.toBeInstanceOf(NotFoundException);
  });

  it('sin nada contestado devuelve null en cada bloque y el perfil económico vacío', async () => {
    const { service } = build();

    await expect(service.getAnswers({ tenantId: 't1', customerId: 'c1', currentUser: cliente })).resolves.toEqual({
      customerId: 'c1',
      personalData: null,
      financialProfile: {},
      address: null,
    });
  });

  it('devuelve el perfil, los números como número, los textos como texto y descarta códigos ajenos al formulario', async () => {
    const { service, profileDataRepository } = build({
      profile: { firstName: 'Ana', lastName: 'Paz', birthDate: '1999-05-01' },
      values: [
        { attributeDefinitionId: 1, valueText: 'employee', valueNumber: null },
        { attributeDefinitionId: 2, valueText: null, valueNumber: '3000.0000' },
        { attributeDefinitionId: 3, valueText: 'bs_3000_5000', valueNumber: null },
        { attributeDefinitionId: 4, valueText: null, valueNumber: 'no-es-numero' },
        { attributeDefinitionId: 5, valueText: 'x', valueNumber: null },
      ],
    });

    const respuestas = await service.getAnswers({ tenantId: 't1', customerId: 'c1', currentUser: cliente });

    expect(respuestas.personalData).toEqual({ firstName: 'Ana', lastName: 'Paz', birthDate: '1999-05-01' });
    expect(respuestas.financialProfile).toEqual({
      employmentStatus: 'employee',
      monthlyIncomeDeclared: 3000,
      monthlyIncomeBand: 'bs_3000_5000',
    });
    expect(profileDataRepository.findCurrentAttributeValues).toHaveBeenCalledWith('t1', 'c1', ['1', '2', '3', '4', '5']);
  });

  it('el domicilio vuelve con la calle DESCIFRADA y la última coordenada de esa versión', async () => {
    const calle = await encryptSecretEnvelope('Av. Busch 1234');
    const { service, answersRepository } = build({
      version: {
        id: 77,
        countryCode: 'BOL',
        department: 'Santa Cruz',
        city: 'Santa Cruz de la Sierra',
        declaredZoneName: 'Equipetrol',
        declaredAddressText: calle,
      },
      gps: { gpsLat: '-17.7700000', gpsLng: '-63.1800000', gpsAccuracyMeters: '12.50' },
    });

    const { address } = await service.getAnswers({ tenantId: 't1', customerId: 'c1', currentUser: operador });

    expect(answersRepository.findLatestGpsForAddressVersion).toHaveBeenCalledWith('t1', '77');
    expect(address).toEqual({
      countryCode: 'BOL',
      department: 'Santa Cruz',
      city: 'Santa Cruz de la Sierra',
      zone: 'Equipetrol',
      addressLine: 'Av. Busch 1234',
      gps: { lat: -17.77, lng: -63.18, accuracyMeters: 12.5 },
    });
  });

  it('una calle que no se puede descifrar vuelve null (la pantalla la pide otra vez) y sin GPS no hay punto', async () => {
    const { service } = build({
      version: {
        id: 78,
        countryCode: 'BOL',
        department: 'La Paz',
        city: 'La Paz',
        declaredZoneName: null,
        declaredAddressText: 'v2:basura',
      },
      gps: { gpsLat: null, gpsLng: '-68.1', gpsAccuracyMeters: null },
    });

    const { address } = await service.getAnswers({ tenantId: 't1', customerId: 'c1', currentUser: cliente });

    expect(address).toMatchObject({ addressLine: null, gps: null, zone: null });
  });

  it('una versión sin calle devuelve la calle null sin intentar descifrar', async () => {
    const { service } = build({
      version: { id: 79, countryCode: 'BOL', department: 'Oruro', city: 'Oruro', declaredZoneName: 'Centro', declaredAddressText: null },
    });

    const { address } = await service.getAnswers({ tenantId: 't1', customerId: 'c1', currentUser: cliente });

    expect(address).toMatchObject({ addressLine: null, gps: null, city: 'Oruro' });
  });

  it('read() no comprueba propiedad: es para quien ya la comprobó (el expediente del alta)', async () => {
    const { service, customersRepository } = build({ profile: { firstName: 'Ana', lastName: null, birthDate: null } });

    await expect(service.read('t1', 'c2')).resolves.toMatchObject({ customerId: 'c2', personalData: { firstName: 'Ana' } });
    expect(customersRepository.findById).not.toHaveBeenCalled();
  });
});
