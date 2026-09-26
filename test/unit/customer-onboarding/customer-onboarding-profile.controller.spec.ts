import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { BadRequestException } from '@nestjs/common';
import { CustomerOnboardingProfileController } from '../../../src/modules/customer-onboarding/customer-onboarding-profile.controller.js';
import type { CustomerProfileUpdateService } from '../../../src/modules/customer-onboarding/application/customer-profile-update.service.js';
import type { CustomerFinancialProfileService } from '../../../src/modules/customer-onboarding/application/customer-financial-profile.service.js';
import type { CustomerReferenceContactsService } from '../../../src/modules/customer-onboarding/application/customer-reference-contacts.service.js';
import type { CustomerContactMethodsService } from '../../../src/modules/customer-onboarding/application/customer-contact-methods.service.js';
import type { CustomerDocumentUploadService } from '../../../src/modules/customer-onboarding/application/customer-document-upload.service.js';
import type { CustomerIdentityProviderVerificationService } from '../../../src/modules/customer-onboarding/application/customer-identity-provider-verification.service.js';
import type { AuthenticatedUser } from '../../../src/common/types/auth.types.js';
import type { RequestWithNetwork } from '../../../src/common/utils/http/headers.util.js';

/**
 * Las siete rutas del expediente del cliente durante el alta.
 *
 * Reparten entre seis servicios, y un cruce entre dos de ellas responde 200 con el efecto
 * equivocado: `addReferences` donde va `addContactMethod` guardaría el teléfono de un TERCERO como
 * método de contacto del cliente —cifrado con otra base legal y en otra tabla—, y nada fallaría.
 *
 * Las dos cosas que además se fijan aquí:
 *
 * La IP se toma de la petición y viaja a todas las escrituras, porque es lo que queda en la
 * bitácora de quién declaró qué; cuando no se conoce viaja nula y no como cadena vacía, que en un
 * registro de auditoría se lee como un dato y no como una ausencia.
 *
 * Y la verificación de identidad EXIGE clave de idempotencia. No es una formalidad: consulta el
 * registro estatal, y cada consulta se factura y se registra a nombre del cliente; reintentar sin
 * clave la repetiría. Se rechaza antes de llamar a nadie.
 */
const CLIENTE = { role: 'customer', tenantId: 't1', customerId: '42', sub: 'sub-1' } as AuthenticatedUser;

function peticion(ip: string | null = '10.0.0.1'): RequestWithNetwork {
  return { ip: ip ?? undefined, headers: {} } as unknown as RequestWithNetwork;
}

describe('CustomerOnboardingProfileController', () => {
  let profile: { updateProfile: jest.Mock };
  let financial: { upsertFinancialProfile: jest.Mock };
  let references: { listReferences: jest.Mock; addReferences: jest.Mock; removeReference: jest.Mock };
  let contacts: { addContactMethod: jest.Mock };
  let uploads: { createUploadUrl: jest.Mock };
  let identity: { verifyWithProvider: jest.Mock };
  let controller: CustomerOnboardingProfileController;

  beforeEach(() => {
    profile = { updateProfile: jest.fn(async () => 'perfil') };
    financial = { upsertFinancialProfile: jest.fn(async () => 'economico') };
    references = {
      listReferences: jest.fn(async () => 'referencias'),
      addReferences: jest.fn(async () => 'alta-referencias'),
      removeReference: jest.fn(async () => 'baja-referencia'),
    };
    contacts = { addContactMethod: jest.fn(async () => 'contacto') };
    uploads = { createUploadUrl: jest.fn(async () => ({ storageKey: 'k/1' })) };
    identity = { verifyWithProvider: jest.fn(async () => 'verificacion') };

    controller = new CustomerOnboardingProfileController(
      profile as unknown as CustomerProfileUpdateService,
      financial as unknown as CustomerFinancialProfileService,
      references as unknown as CustomerReferenceContactsService,
      contacts as unknown as CustomerContactMethodsService,
      uploads as unknown as CustomerDocumentUploadService,
      identity as unknown as CustomerIdentityProviderVerificationService,
    );
  });

  describe('cada ruta llama a lo suyo', () => {
    it('el perfil y el perfil ECONÓMICO son servicios distintos', async () => {
      await expect(
        controller.updateProfile('t1', { customerId: '42' } as never, { firstName: 'Ana' } as never, CLIENTE, peticion()),
      ).resolves.toBe('perfil');
      expect(financial.upsertFinancialProfile).not.toHaveBeenCalled();

      await expect(
        controller.upsertFinancialProfile('t1', { customerId: '42' } as never, { monthlyIncome: 5000 } as never, CLIENTE, peticion()),
      ).resolves.toBe('economico');
      expect(profile.updateProfile).toHaveBeenCalledTimes(1);
    });

    it('una REFERENCIA no se confunde con un método de contacto: son un tercero y el propio cliente', async () => {
      await controller.addReferences('t1', { customerId: '42' } as never, { references: [] } as never, CLIENTE, peticion());
      expect(contacts.addContactMethod).not.toHaveBeenCalled();

      await controller.addContactMethod('t1', { customerId: '42' } as never, { contactType: 'phone' } as never, CLIENTE, peticion());
      expect(references.addReferences).toHaveBeenCalledTimes(1);
    });

    it('listar, dar de alta y quitar referencias son tres métodos distintos del mismo servicio', async () => {
      await controller.listReferences('t1', { customerId: '42' } as never, CLIENTE);
      await controller.addReferences('t1', { customerId: '42' } as never, {} as never, CLIENTE, peticion());
      await controller.removeReference('t1', { customerId: '42', referenceId: 'r-1' } as never, CLIENTE, peticion());

      expect(references.listReferences).toHaveBeenCalledTimes(1);
      expect(references.addReferences).toHaveBeenCalledTimes(1);
      expect(references.removeReference).toHaveBeenCalledWith(expect.objectContaining({ referenceId: 'r-1' }));
    });

    it('el permiso de subida va al servicio de documentos y devuelve la clave impuesta por el servidor', async () => {
      const ticket = await controller.createUploadUrl(
        't1',
        { customerId: '42' } as never,
        { documentType: 'identity_front' } as never,
        CLIENTE,
        peticion(),
      );

      expect(uploads.createUploadUrl).toHaveBeenCalledWith(
        expect.objectContaining({ customerId: '42', body: { documentType: 'identity_front' } }),
      );
      expect(ticket).toMatchObject({ storageKey: 'k/1' });
    });
  });

  describe('el cliente y el tenant salen de la ruta y del token', () => {
    it('el identificador del cliente sale del PARÁMETRO, no del cuerpo', async () => {
      await controller.updateProfile('t1', { customerId: '42' } as never, { customerId: '99' } as never, CLIENTE, peticion());

      expect(profile.updateProfile).toHaveBeenCalledWith(expect.objectContaining({ tenantId: 't1', customerId: '42' }));
    });

    it('el actor del token viaja entero: es quien autoriza y a quien se le atribuye', async () => {
      await controller.updateProfile('t1', { customerId: '42' } as never, {} as never, CLIENTE, peticion());

      expect(profile.updateProfile).toHaveBeenCalledWith(expect.objectContaining({ currentUser: CLIENTE }));
    });

    it('listar referencias NO necesita ip: no escribe nada', async () => {
      await controller.listReferences('t1', { customerId: '42' } as never, CLIENTE);

      expect(references.listReferences).toHaveBeenCalledWith({ tenantId: 't1', customerId: '42', currentUser: CLIENTE });
    });
  });

  describe('la ip de la bitácora', () => {
    it('viaja a TODAS las escrituras', async () => {
      await controller.updateProfile('t1', { customerId: '42' } as never, {} as never, CLIENTE, peticion());
      await controller.upsertFinancialProfile('t1', { customerId: '42' } as never, {} as never, CLIENTE, peticion());
      await controller.addReferences('t1', { customerId: '42' } as never, {} as never, CLIENTE, peticion());
      await controller.removeReference('t1', { customerId: '42', referenceId: 'r-1' } as never, CLIENTE, peticion());
      await controller.addContactMethod('t1', { customerId: '42' } as never, {} as never, CLIENTE, peticion());
      await controller.createUploadUrl('t1', { customerId: '42' } as never, {} as never, CLIENTE, peticion());

      for (const espia of [
        profile.updateProfile,
        financial.upsertFinancialProfile,
        references.addReferences,
        references.removeReference,
        contacts.addContactMethod,
        uploads.createUploadUrl,
      ]) {
        expect(espia).toHaveBeenCalledWith(expect.objectContaining({ ipAddress: '10.0.0.1' }));
      }
    });

    it('cuando no se conoce viaja NULA: una cadena vacía en una auditoría se lee como un dato', async () => {
      await controller.updateProfile('t1', { customerId: '42' } as never, {} as never, CLIENTE, peticion(null));

      expect(profile.updateProfile).toHaveBeenCalledWith(expect.objectContaining({ ipAddress: null }));
    });
  });

  describe('la verificación de identidad', () => {
    it('EXIGE clave de idempotencia: consulta el registro estatal y cada consulta se factura', () => {
      expect(() => controller.verifyIdentity('t1', undefined, { customerId: '42' } as never, {} as never, CLIENTE, peticion())).toThrow(
        BadRequestException,
      );
      expect(identity.verifyWithProvider).not.toHaveBeenCalled();
    });

    it('con clave, la propaga junto al resto del contexto', async () => {
      await controller.verifyIdentity(
        't1',
        'idem-1',
        { customerId: '42' } as never,
        { documentNumber: '123' } as never,
        CLIENTE,
        peticion(),
      );

      expect(identity.verifyWithProvider).toHaveBeenCalledWith({
        tenantId: 't1',
        customerId: '42',
        body: { documentNumber: '123' },
        currentUser: CLIENTE,
        ipAddress: '10.0.0.1',
        idempotencyKey: 'idem-1',
      });
    });

    it('una clave vacía cuenta como ausente: `""` no identifica ningún intento', () => {
      expect(() => controller.verifyIdentity('t1', '', { customerId: '42' } as never, {} as never, CLIENTE, peticion())).toThrow(
        BadRequestException,
      );
    });
  });
});
