import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { Op } from 'sequelize';
import { CustomerDeviceContactsRepository } from '../../../src/modules/customer-device-signals/repositories/customer-device-contacts.repository.js';
import type {
  CustomerConsentModel,
  CustomerDeviceContactModel,
  CustomerDeviceLinkModel,
  CustomerSessionModel,
  OnDeviceComputationRunModel,
} from '../../../src/database/models/index.js';

/**
 * La agenda que el cliente autorizó a compartir.
 *
 * Cuatro decisiones, todas de privacidad, y todas invisibles si se rompen.
 *
 * Un consentimiento RETIRADO sigue en la tabla —es la prueba de que se concedió alguna vez— pero no
 * ampara una escritura nueva: por eso «vigente» exige `granted` y `revoked_at` nulo.
 *
 * Al actualizar una ficha se sobrescriben TODOS los campos y no sólo los que cambiaron: la agenda
 * es un espejo, y una actualización parcial dejaría vivo en nuestra copia el teléfono que la persona
 * borró ayer.
 *
 * El borrado al retirarse el consentimiento es FÍSICO. `_deleted = true` no vale: lo que se le
 * prometió a la persona es que su agenda se borra, y una fila marcada como borrada sigue
 * conteniendo el nombre y el teléfono de cada uno de sus contactos. La prueba de que la agenda
 * existió queda en `on_device_computation_runs`, que no guarda ni un dato personal.
 *
 * Y el solapamiento de teléfonos entre expedientes se resuelve sobre los HASHES, que es lo que
 * permite contestar «¿varias solicitudes distintas comparten los mismos números?» sin descifrar ni
 * una ficha.
 */
type Doble = { create: jest.Mock; findOne: jest.Mock; findAll: jest.Mock; update: jest.Mock; destroy: jest.Mock; count: jest.Mock };

function doble(): Doble {
  return {
    create: jest.fn(async (values: unknown) => values),
    findOne: jest.fn(async () => null),
    findAll: jest.fn(async () => []),
    update: jest.fn(async () => [1]),
    destroy: jest.fn(async () => 3),
    count: jest.fn(async () => 0),
  };
}

function ultima(mock: jest.Mock): { where: Record<string | symbol, unknown>; order?: unknown[]; transaction?: unknown } {
  return mock.mock.calls.at(-1)?.[0] as { where: Record<string, unknown> };
}

const RECIBIDO = new Date('2026-09-10T10:00:00Z');

function ficha(overrides: Record<string, unknown> = {}) {
  return {
    tenantId: 't1',
    customerId: 'c1',
    computationRunId: 'run-1',
    deviceId: 'dev-1',
    sessionId: 's1',
    consentId: 'cs-1',
    contactExternalIdHash: 'h-externo',
    displayNameEncrypted: 'enc',
    givenNameEncrypted: null,
    familyNameEncrypted: null,
    companyEncrypted: null,
    jobTitleEncrypted: null,
    phonesEncrypted: 'enc',
    emailsEncrypted: null,
    addressesEncrypted: null,
    displayNameHash: 'h-nombre',
    primaryPhoneHash: 'h-tel',
    primaryPhoneLast4: '4321',
    phoneHashes: ['h-tel'],
    emailHashes: [],
    phoneCount: 1,
    emailCount: 0,
    addressCount: 0,
    birthday: null,
    isFavorite: false,
    contactType: 'person',
    capturedAt: RECIBIDO,
    receivedAt: RECIBIDO,
    ...overrides,
  } as never;
}

describe('CustomerDeviceContactsRepository', () => {
  let contacts: Doble;
  let runs: Doble;
  let deviceLinks: Doble;
  let sessions: Doble;
  let consents: Doble;
  let repo: CustomerDeviceContactsRepository;
  const tx = {} as never;

  beforeEach(() => {
    contacts = doble();
    runs = doble();
    deviceLinks = doble();
    sessions = doble();
    consents = doble();
    repo = new CustomerDeviceContactsRepository(
      contacts as unknown as typeof CustomerDeviceContactModel,
      runs as unknown as typeof OnDeviceComputationRunModel,
      deviceLinks as unknown as typeof CustomerDeviceLinkModel,
      sessions as unknown as typeof CustomerSessionModel,
      consents as unknown as typeof CustomerConsentModel,
    );
  });

  describe('procedencia de la captura', () => {
    it('el vínculo del dispositivo se busca por cliente y dispositivo, dentro del tenant', async () => {
      await repo.findCustomerDeviceLink('t1', 'c1', 'dev-1');

      expect(ultima(deviceLinks.findOne).where).toEqual({ tenantId: 't1', customerId: 'c1', deviceId: 'dev-1' });
    });

    it('la sesión se busca por su id Y por el cliente: una sesión ajena no debe validar la captura', async () => {
      await repo.findCustomerSession('t1', 'c1', 's1');

      expect(ultima(sessions.findOne).where).toEqual({ tenantId: 't1', customerId: 'c1', id: 's1' });
    });

    it('«vigente» exige concedido y NO retirado, y se toma el más reciente', async () => {
      await repo.findGrantedConsent('t1', 'c1', 'ADDRESS_BOOK');

      const condicion = ultima(consents.findOne).where;
      expect(condicion).toMatchObject({ tenantId: 't1', customerId: 'c1', purposeCode: 'ADDRESS_BOOK', granted: true });
      expect((condicion.revokedAt as Record<symbol, null>)[Op.is]).toBeNull();
      expect(ultima(consents.findOne).order).toEqual([['_id', 'DESC']]);
    });
  });

  describe('la ejecución que agrupa la sincronización', () => {
    it('declara su propio código de algoritmo y que SÍ se guardaron fichas', async () => {
      await repo.createRun(
        {
          tenantId: 't1',
          customerId: 'c1',
          deviceId: 'dev-1',
          sessionId: 's1',
          consentId: 'cs-1',
          onboardingFlowId: null,
          algorithmVersion: '1.0.0',
          status: 'COMPLETED',
          integrityHash: 'h',
          computedAtDevice: RECIBIDO,
          receivedAtServer: RECIBIDO,
        },
        { transaction: tx },
      );

      const [values, opciones] = runs.create.mock.calls.at(-1) as [Record<string, unknown>, { transaction: unknown }];
      expect(values.algorithmCode).toBe('CONTACTS_ADDRESS_BOOK_SYNC');
      expect(values.rawContactsStored).toBe(true);
      expect(values.rawSmsStored).toBe(false);
      expect(opciones.transaction).toBe(tx);
    });

    it('el código de algoritmo NO lo elige quien llama', async () => {
      await repo.createRun(
        {
          tenantId: 't1',
          customerId: 'c1',
          deviceId: null,
          sessionId: null,
          consentId: null,
          onboardingFlowId: null,
          algorithmVersion: '1.0.0',
          status: 'COMPLETED',
          integrityHash: 'h',
          computedAtDevice: RECIBIDO,
          receivedAtServer: RECIBIDO,
          algorithmCode: 'OTRO',
        } as never,
        {},
      );

      expect((runs.create.mock.calls.at(-1)?.[0] as Record<string, unknown>).algorithmCode).toBe('CONTACTS_ADDRESS_BOOK_SYNC');
    });
  });

  describe('fichas', () => {
    it('las existentes se buscan por hash del identificador de origen, sin las borradas', async () => {
      await repo.findByExternalIdHashes('t1', 'c1', ['h1', 'h2'], { transaction: tx });

      const condicion = ultima(contacts.findAll).where;
      expect((condicion.contactExternalIdHash as Record<symbol, string[]>)[Op.in]).toEqual(['h1', 'h2']);
      expect((condicion.deleted as Record<symbol, boolean>)[Op.ne]).toBe(true);
      expect(ultima(contacts.findAll).transaction).toBe(tx);
    });

    it('sin hashes no se consulta: un `IN ()` vacío traería la agenda entera', async () => {
      await expect(repo.findByExternalIdHashes('t1', 'c1', [])).resolves.toEqual([]);
      expect(contacts.findAll).not.toHaveBeenCalled();
    });

    it('una ficha nueva nace viva y declarando de dónde vino', async () => {
      await repo.create(ficha(), { transaction: tx });

      const [values] = contacts.create.mock.calls.at(-1) as [Record<string, unknown>];
      expect(values.source).toBe('device_address_book');
      expect(values.deleted).toBe(false);
      expect(values.createdAtValue).toBe(RECIBIDO);
      expect(values.updatedAtValue).toBe(RECIBIDO);
    });

    it('actualizar es un ESPEJO: reescribe todos los campos mutables de golpe', async () => {
      await repo.update('n-1', ficha({ phoneCount: 0, phonesEncrypted: null, phoneHashes: [] }), { transaction: tx });

      const [values, opciones] = contacts.update.mock.calls.at(-1) as [Record<string, unknown>, { where: unknown }];
      expect(values.phonesEncrypted).toBeNull();
      expect(values.phoneHashes).toEqual([]);
      expect(values.phoneCount).toBe(0);
      expect(opciones.where).toEqual({ id: 'n-1' });
    });

    it('actualizar NO reescribe la identidad de la fila: tenant, cliente ni hash de origen', async () => {
      await repo.update('n-1', ficha());

      const [values] = contacts.update.mock.calls.at(-1) as [Record<string, unknown>];
      expect(values).not.toHaveProperty('tenantId');
      expect(values).not.toHaveProperty('customerId');
      expect(values).not.toHaveProperty('contactExternalIdHash');
      expect(values.updatedAtValue).toBe(RECIBIDO);
    });

    it('contar excluye las borradas', async () => {
      await repo.countFor('t1', 'c1', { transaction: tx });

      const condicion = ultima(contacts.count).where;
      expect(condicion).toMatchObject({ tenantId: 't1', customerId: 'c1' });
      expect((condicion.deleted as Record<symbol, boolean>)[Op.ne]).toBe(true);
    });
  });

  describe('retirada del consentimiento', () => {
    it('el borrado es FÍSICO: una fila marcada como borrada seguiría teniendo nombres y teléfonos', async () => {
      const borradas = await repo.deleteAllFor('t1', 'c1', { transaction: tx });

      expect(contacts.destroy).toHaveBeenCalledWith({ where: { tenantId: 't1', customerId: 'c1' }, transaction: tx });
      expect(contacts.update).not.toHaveBeenCalled();
      expect(borradas).toBe(3);
    });

    it('se lleva TODA la agenda del cliente, incluida la ya marcada como borrada', async () => {
      await repo.deleteAllFor('t1', 'c1');

      expect(ultima(contacts.destroy).where).toEqual({ tenantId: 't1', customerId: 'c1' });
      expect(ultima(contacts.destroy).where).not.toHaveProperty('deleted');
    });
  });

  describe('solapamiento entre expedientes', () => {
    it('cuenta CLIENTES distintos y no fichas: dos números del mismo tercero son un solo solapamiento', async () => {
      await repo.countPhoneOverlapWithOtherCustomers({ tenantId: 't1', customerId: 'c1', phoneHashes: ['h1', 'h2'] });

      const llamada = contacts.count.mock.calls.at(-1)?.[0] as { distinct: boolean; col: string; where: Record<string | symbol, unknown> };
      expect(llamada.distinct).toBe(true);
      expect(llamada.col).toBe('customer_id');
    });

    it('se resuelve sobre los HASHES y excluye al propio cliente', async () => {
      await repo.countPhoneOverlapWithOtherCustomers({ tenantId: 't1', customerId: 'c1', phoneHashes: ['h1'] });

      const condicion = ultima(contacts.count).where;
      expect((condicion.customerId as Record<symbol, string>)[Op.ne]).toBe('c1');
      expect((condicion.phoneHashes as Record<symbol, string[]>)[Op.overlap]).toEqual(['h1']);
    });

    it('sin teléfonos no hay solapamiento que contar y no se consulta', async () => {
      await expect(repo.countPhoneOverlapWithOtherCustomers({ tenantId: 't1', customerId: 'c1', phoneHashes: [] })).resolves.toBe(0);
      expect(contacts.count).not.toHaveBeenCalled();
    });
  });
});
