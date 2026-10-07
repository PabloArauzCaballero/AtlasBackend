import { ForbiddenException, Logger, NotFoundException } from '@nestjs/common';
import type { Sequelize } from 'sequelize-typescript';
import { CustomerAddressBookService } from '../../../src/modules/customer-device-signals/application/customer-address-book.service';
import type { DeviceSignalsAccessService } from '../../../src/modules/customer-device-signals/application/device-signals-access.service';
import type { CustomerDeviceContactsRepository } from '../../../src/modules/customer-device-signals/repositories/customer-device-contacts.repository';
import type { DeviceSignalsJournalRepository } from '../../../src/modules/customer-device-signals/repositories/device-signals-journal.repository';
import type { CustomersRepository } from '../../../src/modules/customers/customers.repository';
import type { InternalRbacRepository } from '../../../src/modules/internal-users/internal-rbac.repository';
import type { AuthenticatedUser } from '../../../src/common/types/auth.types';

jest.mock('../../../src/modules/customer-device-signals/application/device-contact-row', () => ({
  toContactRow: jest.fn(async (contacto: { externalId: string; phones: Array<{ number: string }> }) => ({
    contactExternalIdHash: `ext-${contacto.externalId}`,
    phoneHashes: contacto.phones.map((telefono) => `ph-${telefono.number}`),
  })),
}));

const usuario = { role: 'customer', userId: 'c1', customerId: 'c1' } as unknown as AuthenticatedUser;
const tx = { id: 'tx' };

const contacto = (externalId: string, numero?: string) => ({ externalId, phones: numero ? [{ number: numero }] : [] });

function build() {
  const access = { resolve: jest.fn(async () => ({ deviceId: 'dev-1', consentId: '9' })) };
  const journal = {
    findLatestOnboardingFlow: jest.fn(async () => null),
    recordAddressBookSync: jest.fn(async () => undefined),
    createAuditLog: jest.fn(async () => undefined),
  };
  const contacts = {
    createRun: jest.fn(async () => ({ id: 77 })),
    findByExternalIdHashes: jest.fn(async (): Promise<Array<{ id: number; contactExternalIdHash: string }>> => []),
    create: jest.fn(async () => undefined),
    update: jest.fn(async () => [1]),
    countFor: jest.fn(async () => 3),
    findStoredPhoneHashes: jest.fn(async () => ['ph-1', 'ph-2', 'ph-3']),
    countPhoneOverlapWithOtherCustomers: jest.fn(async () => 2),
    deleteAllFor: jest.fn(async () => 5),
  };
  const customers = { findById: jest.fn(async (): Promise<unknown> => ({ id: 'c1' })) };
  const rbac = { hasPermissions: jest.fn(async () => true) };
  const sequelize = { transaction: jest.fn(async (cb: (t: unknown) => Promise<unknown>) => cb(tx)) };
  const service = new CustomerAddressBookService(
    customers as unknown as CustomersRepository,
    access as unknown as DeviceSignalsAccessService,
    journal as unknown as DeviceSignalsJournalRepository,
    contacts as unknown as CustomerDeviceContactsRepository,
    rbac as unknown as InternalRbacRepository,
    sequelize as unknown as Sequelize,
  );
  return { service, journal, contacts, customers, sequelize, rbac };
}

const body = (overrides: Record<string, unknown> = {}) =>
  ({
    deviceId: 'dev-1',
    sessionId: null,
    algorithmVersion: 'v1',
    capturedAt: '2026-10-05T10:00:00.000Z',
    isFinalBatch: true,
    totalContactsInDevice: 3,
    accessScope: 'all',
    contacts: [contacto('a', '1')],
    ...overrides,
  }) as never;

const sync = (service: CustomerAddressBookService, overrides: Record<string, unknown> = {}) =>
  service.sync({ tenantId: 't1', customerId: 'c1', body: body(overrides), currentUser: usuario, ipAddress: '1.1.1.1' });

beforeEach(() => {
  jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
});
afterEach(() => jest.restoreAllMocks());

describe('CustomerAddressBookService', () => {
  it('el cruce antifraude del último lote usa TODA la agenda guardada, no sólo el lote, y dentro de la transacción', async () => {
    const { service, contacts, journal } = build();

    await sync(service);

    expect(contacts.findStoredPhoneHashes).toHaveBeenCalledWith('t1', 'c1', { transaction: tx });
    expect(contacts.countPhoneOverlapWithOtherCustomers).toHaveBeenCalledWith(
      { tenantId: 't1', customerId: 'c1', phoneHashes: ['ph-1', 'ph-2', 'ph-3'] },
      { transaction: tx },
    );
    expect(journal.recordAddressBookSync).toHaveBeenCalledWith(expect.objectContaining({ customersSharingContacts: 2 }), { transaction: tx });
  });

  it('un lote intermedio no calcula el cruce', async () => {
    const { service, contacts, journal } = build();

    await sync(service, { isFinalBatch: false });

    expect(contacts.countPhoneOverlapWithOtherCustomers).not.toHaveBeenCalled();
    expect(journal.recordAddressBookSync).toHaveBeenCalledWith(expect.objectContaining({ customersSharingContacts: null }), { transaction: tx });
  });

  it('crea lo nuevo y actualiza lo conocido por su identificador de origen', async () => {
    const { service, contacts } = build();
    contacts.findByExternalIdHashes.mockResolvedValueOnce([{ id: 5, contactExternalIdHash: 'ext-a' }]);

    const vista = await sync(service, { contacts: [contacto('a'), contacto('b')] });

    expect(contacts.update).toHaveBeenCalledTimes(1);
    expect(contacts.create).toHaveBeenCalledTimes(1);
    expect(vista).toMatchObject({ received: 2, created: 1, updated: 1, totalStored: 3, computationRunId: '77' });
  });

  it('un contacto repetido dentro del lote se guarda UNA vez', async () => {
    const { service, contacts } = build();

    const vista = await sync(service, { contacts: [contacto('a', '1'), contacto('a', '2')] });

    expect(contacts.create).toHaveBeenCalledTimes(1);
    expect(vista.received).toBe(1);
  });

  it('un reenvío concurrente que choca con la unicidad se reintenta una vez', async () => {
    const { service, sequelize, contacts } = build();
    sequelize.transaction.mockRejectedValueOnce(Object.assign(new Error('dup'), { name: 'SequelizeUniqueConstraintError' }));

    await expect(sync(service)).resolves.toMatchObject({ computationRunId: '77' });
    expect(contacts.createRun).toHaveBeenCalledTimes(1);
  });

  it('cualquier otro error de escritura se propaga', async () => {
    const { service, sequelize } = build();
    sequelize.transaction.mockRejectedValueOnce(new Error('connection reset'));

    await expect(sync(service)).rejects.toThrow('connection reset');
  });

  it('purge borra físicamente y deja traza de auditoría', async () => {
    const { service, contacts, journal } = build();

    const resultado = await service.purge({ tenantId: 't1', customerId: 'c1', currentUser: usuario, ipAddress: null });

    expect(resultado).toMatchObject({ customerId: 'c1', deleted: 5 });
    expect(contacts.deleteAllFor).toHaveBeenCalledWith('t1', 'c1', { transaction: tx });
    expect(journal.createAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ actionCode: 'customer_device_signals.address_book_purge', payloadJson: { deleted: 5 } }),
      { transaction: tx },
    );
  });

  it('un operador interno sin privacy.requests.manage no puede borrar la agenda de un cliente', async () => {
    const { service, rbac, contacts } = build();
    rbac.hasPermissions.mockResolvedValueOnce(false);
    const operador = { role: 'internal_operator', internalUserId: '5' } as unknown as AuthenticatedUser;

    await expect(service.purge({ tenantId: 't1', customerId: 'c1', currentUser: operador, ipAddress: null })).rejects.toThrow(ForbiddenException);
    expect(rbac.hasPermissions).toHaveBeenCalledWith('t1', '5', ['privacy.requests.manage']);
    expect(contacts.deleteAllFor).not.toHaveBeenCalled();
  });

  it('un operador interno con el permiso sí puede; uno sin sesión interna no', async () => {
    const { service, contacts } = build();
    const operador = { role: 'internal_operator', internalUserId: '5' } as unknown as AuthenticatedUser;
    await expect(service.purge({ tenantId: 't1', customerId: 'c1', currentUser: operador, ipAddress: null })).resolves.toMatchObject({ deleted: 5 });

    const sinSesion = { role: 'admin' } as unknown as AuthenticatedUser;
    await expect(service.purge({ tenantId: 't1', customerId: 'c1', currentUser: sinSesion, ipAddress: null })).rejects.toThrow(ForbiddenException);
    expect(contacts.deleteAllFor).toHaveBeenCalledTimes(1);
  });

  it('purge de un cliente inexistente es 404 y no borra nada', async () => {
    const { service, customers, contacts } = build();
    customers.findById.mockResolvedValueOnce(null);

    await expect(service.purge({ tenantId: 't1', customerId: 'c1', currentUser: usuario, ipAddress: null })).rejects.toThrow(NotFoundException);
    expect(contacts.deleteAllFor).not.toHaveBeenCalled();
  });
});
