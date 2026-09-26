import { describe, expect, it, jest } from '@jest/globals';
import { ConflictException, UnprocessableEntityException } from '@nestjs/common';
import { ContactMethodResolutionService } from '../../../src/modules/customer-onboarding/application/contact-method-resolution.service.js';

/**
 * Corrección de un contacto mal escrito, de punta a punta.
 *
 * Era un callejón sin salida: `POST /contact-methods` creaba el contacto nuevo como secundario, pero
 * la búsqueda ordenaba por `isPrimary DESC`, así que el código seguía viajando al teléfono
 * equivocado por más veces que el cliente lo corrigiera. Estas pruebas fijan las dos mitades del
 * arreglo: elegir el contacto correcto y dejarlo como principal cuando se verifica.
 */
describe('ContactMethodResolutionService', () => {
  function build() {
    const customersRepository = { findByContactHash: jest.fn(async (..._args: unknown[]) => null) };
    const customerContactsRepository = { updatePrimaryContact: jest.fn() };
    const contactVerificationRepository = {
      findCustomerContactMethod: jest.fn(async (..._args: unknown[]) => ({ id: 'contact-1', isPrimary: true })),
      findCustomerContactMethodById: jest.fn(async (..._args: unknown[]) => ({ id: 'contact-2', isPrimary: false })),
      promoteContactMethodToPrimary: jest.fn(),
    };
    const service = new ContactMethodResolutionService(
      customersRepository as never,
      customerContactsRepository as never,
      contactVerificationRepository as never,
    );
    return { service, customersRepository, customerContactsRepository, contactVerificationRepository };
  }

  const transaction = {} as never;

  describe('resolve', () => {
    it('con contactMethodId explícito manda el cliente: es como corrige un dato mal escrito', async () => {
      const { service, contactVerificationRepository } = build();

      const contact = await service.resolve({
        tenantId: 't1',
        customerId: 'c1',
        contactType: 'phone',
        contactMethodId: '2',
        transaction,
      });

      expect(contact).toMatchObject({ id: 'contact-2' });
      expect(contactVerificationRepository.findCustomerContactMethodById).toHaveBeenCalledWith('t1', 'c1', 'phone', '2', {
        transaction,
      });
      expect(contactVerificationRepository.findCustomerContactMethod).not.toHaveBeenCalled();
    });

    it('sin id explícito el servidor elige el contacto de ese tipo que falta verificar', async () => {
      const { service, contactVerificationRepository } = build();

      const contact = await service.resolve({ tenantId: 't1', customerId: 'c1', contactType: 'phone', transaction });

      expect(contact).toMatchObject({ id: 'contact-1' });
      expect(contactVerificationRepository.findCustomerContactMethodById).not.toHaveBeenCalled();
    });

    it('rechaza con CONTACT_NOT_REGISTERED cuando no hay contacto de ese tipo', async () => {
      const { service, contactVerificationRepository } = build();
      (contactVerificationRepository.findCustomerContactMethod as jest.Mock).mockResolvedValueOnce(null as never);

      await expect(service.resolve({ tenantId: 't1', customerId: 'c1', contactType: 'email', transaction })).rejects.toThrow(
        UnprocessableEntityException,
      );
    });

    /** Un id ajeno no puede resolverse: la consulta filtra por cliente además de por id. */
    it('rechaza un contactMethodId que no resuelve para ese cliente', async () => {
      const { service, contactVerificationRepository } = build();
      (contactVerificationRepository.findCustomerContactMethodById as jest.Mock).mockResolvedValueOnce(null as never);

      await expect(
        service.resolve({ tenantId: 't1', customerId: 'c1', contactType: 'phone', contactMethodId: '99', transaction }),
      ).rejects.toThrow(/CONTACT_NOT_REGISTERED/);
    });
  });

  describe('promoteToPrimary', () => {
    const customer = { id: 'c1' } as never;
    const now = new Date('2026-08-18T00:00:00.000Z');

    it('no hace nada cuando el contacto ya era el principal — el caso normal del registro', async () => {
      const { service, customerContactsRepository, contactVerificationRepository } = build();

      const result = await service.promoteToPrimary({
        tenantId: 't1',
        customer,
        contactMethod: { id: 'contact-1', isPrimary: true, contactValueHash: 'h' } as never,
        now,
        transaction,
      });

      expect(result).toEqual({ promoted: false });
      expect(contactVerificationRepository.promoteContactMethodToPrimary).not.toHaveBeenCalled();
      expect(customerContactsRepository.updatePrimaryContact).not.toHaveBeenCalled();
    });

    it('promueve el contacto verificado y sincroniza las columnas del cliente', async () => {
      const { service, customerContactsRepository, contactVerificationRepository } = build();
      const contactMethod = {
        id: 'contact-2',
        isPrimary: false,
        contactType: 'phone',
        contactValueHash: 'hash-nuevo',
        valueLast4: '9876',
        emailDomain: null,
      } as never;

      const result = await service.promoteToPrimary({ tenantId: 't1', customer, contactMethod, now, transaction });

      expect(result).toEqual({ promoted: true });
      expect(contactVerificationRepository.promoteContactMethodToPrimary).toHaveBeenCalledWith(contactMethod, now, { transaction });
      expect(customerContactsRepository.updatePrimaryContact).toHaveBeenCalledWith(
        customer,
        { contactType: 'phone', contactValueHash: 'hash-nuevo', valueLast4: '9876', emailDomain: null },
        now,
        { transaction },
      );
    });

    /**
     * Los índices únicos parciales de `customers` lo rechazarían igual, pero como error de driver a
     * mitad de la transacción en vez de como el conflicto de negocio que es.
     */
    it('rechaza promover un valor que ya pertenece a otro cliente del tenant', async () => {
      const { service, customersRepository, customerContactsRepository } = build();
      (customersRepository.findByContactHash as jest.Mock).mockResolvedValueOnce({ id: 'otro-cliente' } as never);

      await expect(
        service.promoteToPrimary({
          tenantId: 't1',
          customer,
          contactMethod: { id: 'contact-2', isPrimary: false, contactType: 'phone', contactValueHash: 'h' } as never,
          now,
          transaction,
        }),
      ).rejects.toThrow(ConflictException);
      expect(customerContactsRepository.updatePrimaryContact).not.toHaveBeenCalled();
    });

    /** Sin huella no hay nada que sincronizar: promover a ciegas dejaría la columna sin resolver. */
    it('no promueve un contacto sin hash del valor', async () => {
      const { service, customerContactsRepository } = build();

      const result = await service.promoteToPrimary({
        tenantId: 't1',
        customer,
        contactMethod: { id: 'contact-3', isPrimary: false, contactType: 'phone', contactValueHash: null } as never,
        now,
        transaction,
      });

      expect(result).toEqual({ promoted: false });
      expect(customerContactsRepository.updatePrimaryContact).not.toHaveBeenCalled();
    });
  });
});
