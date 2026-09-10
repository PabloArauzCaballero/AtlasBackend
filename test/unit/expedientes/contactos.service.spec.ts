import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { ContactosService } from '../../../src/modules/expedientes/application/contactos.service.js';
import { encryptSecretEnvelope } from '../../../src/common/utils/crypto/envelope-encryption.util.js';
import type { CustomerContactsRepository } from '../../../src/modules/customers/repositories/customer-contacts.repository.js';
import type { ExpedientesRepository } from '../../../src/modules/expedientes/repositories/expedientes.repository.js';
import type {
  CustomerReferenceContactModel,
  OnDeviceComputationRunModel,
  OnDeviceMetricValueModel,
} from '../../../src/database/models/index.js';
import type { ActorExpediente } from '../../../src/modules/expedientes/expedientes.types.js';

/**
 * Los contactos del expediente, servidos desde la BASE y no desde el almacén.
 *
 * Lo que se fija es la asimetría entre leer y REVELAR.
 *
 * Ver el teléfono completo de la referencia de un cliente no es un grado más de «leer el
 * expediente»: es acceder al dato de un TERCERO que no es cliente de Atlas y que dio su número para
 * que le llamaran una vez. Por eso exige permiso propio, motivo escrito y queda en la bitácora.
 *
 * Y sin revelar NO se descifra NADA. El enmascarado sale de columnas que la fila ya guarda en claro
 * para esto —`valueLast4`, `emailDomain`— y no de recortar el valor descifrado. La diferencia
 * importa: así el camino normal de la pantalla nunca toca la clave de cifrado, y descifrar queda
 * como una acción excepcional que deja rastro.
 *
 * De la agenda sólo salen AGREGADOS, porque del alta móvil el servidor recibe cuentas y hashes de
 * un solo uso que cruza y descarta. Y `skipped` —la persona se NEGÓ a compartirla— se distingue de
 * «no se preguntó»: leer una negativa como una ausencia es perder la respuesta.
 */
const SIN_PERMISO: ActorExpediente = { tipo: 'internal_user', id: '7', roles: [], permisos: [] };
const CON_PERMISO: ActorExpediente = { ...SIN_PERMISO, permisos: ['expedientes.pii.revelar'] };

describe('ContactosService', () => {
  let contactos: { findContactMethods: jest.Mock };
  let repository: { registrar: jest.Mock };
  let referencias: { findAll: jest.Mock };
  let corridas: { findOne: jest.Mock };
  let metricas: { findAll: jest.Mock };
  let service: ContactosService;

  beforeEach(() => {
    contactos = { findContactMethods: jest.fn(async () => []) };
    repository = { registrar: jest.fn(async () => undefined) };
    referencias = { findAll: jest.fn(async () => []) };
    corridas = { findOne: jest.fn(async () => null) };
    metricas = { findAll: jest.fn(async () => []) };
    service = new ContactosService(
      contactos as unknown as CustomerContactsRepository,
      repository as unknown as ExpedientesRepository,
      referencias as unknown as typeof CustomerReferenceContactModel,
      corridas as unknown as typeof OnDeviceComputationRunModel,
      metricas as unknown as typeof OnDeviceMetricValueModel,
    );
  });

  function componer(overrides: Record<string, unknown> = {}) {
    return service.componer({
      tenantId: 't1',
      expedienteId: 'exp-1',
      customerId: 'c1',
      actor: SIN_PERMISO,
      revelar: false,
      ...overrides,
    } as never);
  }

  describe('revelar es una acción aparte', () => {
    it('sin el permiso propio no se revela, aunque se pueda leer el expediente', async () => {
      await expect(componer({ revelar: true, motivo: 'llamada de verificación' })).rejects.toBeInstanceOf(ForbiddenException);
      expect(contactos.findContactMethods).not.toHaveBeenCalled();
    });

    it('con permiso pero sin motivo escrito tampoco', async () => {
      await expect(componer({ actor: CON_PERMISO, revelar: true })).rejects.toBeInstanceOf(BadRequestException);
    });

    it('un motivo de trámite no cuenta: se exige algo que se pueda leer después', async () => {
      await expect(componer({ actor: CON_PERMISO, revelar: true, motivo: 'ok' })).rejects.toBeInstanceOf(BadRequestException);
      await expect(componer({ actor: CON_PERMISO, revelar: true, motivo: '        ' })).rejects.toBeInstanceOf(BadRequestException);
    });

    it('revelar queda en la BITÁCORA con su motivo y a quién se le abrió', async () => {
      await componer({ actor: CON_PERMISO, revelar: true, motivo: '  verificación de referencia  ' });

      expect(repository.registrar).toHaveBeenCalledWith(
        expect.objectContaining({
          accion: 'revelar_pii',
          actorId: '7',
          detalle: { motivo: 'verificación de referencia', customerId: 'c1' },
        }),
      );
    });

    it('leer sin revelar NO escribe en la bitácora de revelado', async () => {
      await componer();

      expect(repository.registrar).not.toHaveBeenCalled();
    });
  });

  describe('el enmascarado no descifra', () => {
    it('un teléfono se reconoce por sus últimos cuatro dígitos sin poder llamarse', async () => {
      contactos.findContactMethods.mockResolvedValueOnce([
        {
          contactType: 'phone',
          contactValueEncrypted: 'ENC',
          valueLast4: '4321',
          emailDomain: null,
          isPrimary: true,
          status: 'verified',
          sourceType: 'onboarding',
          firstSeenAt: new Date('2026-09-01T10:00:00Z'),
        },
      ] as never);

      const dto = await componer();

      expect(dto.metodosDeContacto[0].valor).toBe('•••• 4321');
      expect(dto.enmascarado).toBe(true);
      expect(dto.metodosDeContacto[0].vistoPorPrimeraVez).toBe('2026-09-01T10:00:00.000Z');
    });

    it('un correo se reconoce por su dominio', async () => {
      contactos.findContactMethods.mockResolvedValueOnce([
        { contactType: 'email', contactValueEncrypted: 'ENC', valueLast4: null, emailDomain: 'gmail.com', status: 'verified' },
      ] as never);

      const dto = await componer();

      expect(dto.metodosDeContacto[0].valor).toBe('•••@gmail.com');
    });

    it('sin columnas para enmascarar se devuelve nulo en vez de descifrar «sólo un poco»', async () => {
      contactos.findContactMethods.mockResolvedValueOnce([
        { contactType: 'phone', contactValueEncrypted: 'ENC', valueLast4: null, emailDomain: null },
        { contactType: 'email', contactValueEncrypted: 'ENC', valueLast4: null, emailDomain: null },
      ] as never);

      const dto = await componer();

      expect(dto.metodosDeContacto.map((m) => m.valor)).toEqual([null, null]);
    });

    it('el nombre y el teléfono de una referencia NO salen sin revelar, sólo sus últimos cuatro', async () => {
      referencias.findAll.mockResolvedValueOnce([
        {
          relationshipType: 'familiar',
          fullNameEncrypted: 'ENC-NOMBRE',
          phoneEncrypted: 'ENC-TEL',
          phoneLast4: '9876',
          consentBasis: 'declarada',
          contactabilityStatus: 'ok',
          verificationStatus: 'pending',
          referenceNotified: false,
          referenceNotifiedAt: null,
        },
      ] as never);

      const dto = await componer();

      expect(dto.referencias[0].nombre).toBeNull();
      expect(dto.referencias[0].telefono).toBeNull();
      expect(dto.referencias[0].telefonoUltimos4).toBe('9876');
      expect(dto.referencias[0].baseDeConsentimiento).toBe('declarada');
    });

    it('al revelar sí se descifra, y lo que sale es el valor real', async () => {
      const sobreTelefono = await encryptSecretEnvelope('+591 70000000');
      const sobreNombre = await encryptSecretEnvelope('Ana Rojas');
      contactos.findContactMethods.mockResolvedValueOnce([
        { contactType: 'phone', contactValueEncrypted: sobreTelefono, valueLast4: '0000' },
      ] as never);
      referencias.findAll.mockResolvedValueOnce([
        { relationshipType: 'familiar', fullNameEncrypted: sobreNombre, phoneEncrypted: sobreTelefono, phoneLast4: '0000' },
      ] as never);

      const dto = await componer({ actor: CON_PERMISO, revelar: true, motivo: 'verificación de referencia' });

      expect(dto.enmascarado).toBe(false);
      expect(dto.metodosDeContacto[0].valor).toBe('+591 70000000');
      expect(dto.referencias[0].nombre).toBe('Ana Rojas');
      expect(dto.referencias[0].telefono).toBe('+591 70000000');
    });
  });

  describe('la agenda', () => {
    it('sin ninguna corrida se declara SIN DATOS, no cero', async () => {
      const dto = await componer();

      expect(dto.agenda).toEqual({ estado: 'sin_datos', recuentos: {} });
    });

    it('se lee la corrida MÁS RECIENTE del cliente', async () => {
      corridas.findOne.mockResolvedValueOnce({ id: 9, computationStatus: 'completed', rawContactsStored: false } as never);

      await componer();

      const llamada = corridas.findOne.mock.calls.at(-1)?.[0] as { where: Record<string, unknown>; order: unknown[] };
      expect(llamada.where).toEqual({ tenantId: 't1', customerId: 'c1' });
      expect(llamada.order).toEqual([['_id', 'DESC']]);
    });

    it('«se negó a compartirla» se distingue de «no se preguntó»', async () => {
      corridas.findOne.mockResolvedValueOnce({ id: 9, computationStatus: 'skipped', rawContactsStored: false } as never);

      const dto = await componer();

      expect(dto.agenda.estado).toBe('skipped');
      expect(dto.agenda.estado).not.toBe('sin_datos');
    });

    it('sólo salen RECUENTOS numéricos, y las métricas sin valor no ensucian el mapa', async () => {
      corridas.findOne.mockResolvedValueOnce({ id: 9, computationStatus: 'completed', rawContactsStored: true } as never);
      metricas.findAll.mockResolvedValueOnce([
        { metricCode: 'contacts_total', valueNumber: '340' },
        { metricCode: 'unique_phones', valueNumber: 300 },
        { metricCode: 'sin_valor', valueNumber: null },
        { metricCode: null, valueNumber: 5 },
      ] as never);

      const dto = await componer();

      expect(dto.agenda.recuentos).toEqual({ contacts_total: 340, unique_phones: 300 });
      expect(dto.agenda.fichasGuardadas).toBe(true);
    });

    it('las métricas se piden para ESA corrida, no para todas las del cliente', async () => {
      corridas.findOne.mockResolvedValueOnce({ id: 9, computationStatus: 'completed' } as never);

      await componer();

      expect((metricas.findAll.mock.calls.at(-1)?.[0] as { where: Record<string, unknown> }).where).toEqual({
        tenantId: 't1',
        computationRunId: '9',
      });
    });

    it('un estado ausente se declara desconocido y no se omite', async () => {
      corridas.findOne.mockResolvedValueOnce({ id: 9, computationStatus: null } as never);

      const dto = await componer();

      expect(dto.agenda.estado).toBe('desconocido');
      expect(dto.agenda.fichasGuardadas).toBe(false);
    });
  });

  describe('la composición', () => {
    it('se compone en cada petición y lo declara: no es un objeto guardado que envejece', async () => {
      const antes = Date.now();

      const dto = await componer();

      expect(dto.version).toBe(1);
      expect(Date.parse(dto.generadoEn)).toBeGreaterThanOrEqual(antes);
      expect(dto.customerId).toBe('c1');
    });
  });
});
