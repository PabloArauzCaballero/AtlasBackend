import { describe, expect, it, jest } from '@jest/globals';
import { Op } from 'sequelize';
import { CustomerProfileDataRepository } from '../../../src/modules/customer-onboarding/repositories/customer-profile-data.repository.js';

/**
 * Persistencia del perfil, sus atributos, sus referencias y sus contactos.
 *
 * Todo lo que hay aquí es versionado o append-only a propósito: el expediente de un cliente no se
 * sobrescribe, se cierra y se sustituye. Estas pruebas fijan esa forma —qué se cierra, qué se crea
 * vigente y qué se borra en lógico— porque es exactamente lo que se pierde en un refactor que
 * "simplifica" un `update`.
 */
describe('CustomerProfileDataRepository', () => {
  function build() {
    const model = () => ({
      findOne: jest.fn(async (..._args: unknown[]) => null),
      findAll: jest.fn(async (..._args: unknown[]) => []),
      create: jest.fn(async (..._args: unknown[]) => ({ id: 'nuevo' })),
    });
    const models = { profile: model(), attributeValue: model(), definition: model(), reference: model(), contactMethod: model() };
    const repository = new CustomerProfileDataRepository(
      models.profile as never,
      models.attributeValue as never,
      models.definition as never,
      models.reference as never,
      models.contactMethod as never,
    );
    return { repository, models };
  }

  const transaction = {} as never;
  const now = new Date('2026-08-18T00:00:00.000Z');
  const firstArg = (mock: jest.Mock) => mock.mock.calls[0][0] as Record<string, unknown>;

  describe('perfil versionado', () => {
    it('la versión vigente es la que no tiene cierre, y desempata por la más reciente', async () => {
      const { repository, models } = build();
      await repository.findCurrentProfile('t1', 'c1', { transaction });
      expect(firstArg(models.profile.findOne as jest.Mock)).toMatchObject({
        where: { tenantId: 't1', customerId: 'c1', validUntil: null },
        order: [
          ['validFrom', 'DESC'],
          ['id', 'DESC'],
        ],
      });
    });

    /** Corregir un dato no puede perder el anterior: la versión se cierra, no se pisa. */
    it('cerrar una versión le pone fecha de fin y la guarda en la transacción', async () => {
      const { repository } = build();
      const profile = { validUntil: null as Date | null, save: jest.fn(async (..._args: unknown[]) => undefined) };
      await repository.closeProfileVersion(profile as never, now, { transaction });
      expect(profile.validUntil).toBe(now);
      expect(profile.save).toHaveBeenCalledWith({ transaction });
    });

    it('la versión nueva nace vigente y apunta a la que sustituye', async () => {
      const { repository, models } = build();
      await repository.createProfileVersion(
        {
          tenantId: 't1',
          customerId: 'c1',
          firstName: 'Ana',
          lastName: 'Paz',
          fullNameNormalized: 'ana paz',
          birthDate: '1990-01-01',
          ageAtCapture: 36,
          genderDeclared: null,
          preferredLanguage: 'es',
          marketingOptIn: false,
          sourceType: 'mobile_app',
          supersedesVersionId: 'v1',
          validFrom: now,
        },
        { transaction },
      );
      expect(firstArg(models.profile.create as jest.Mock)).toMatchObject({
        validFrom: now,
        validUntil: null,
        supersedesVersionId: 'v1',
        createdAtValue: now,
      });
    });
  });

  describe('atributos económicos', () => {
    it('sólo resuelve definiciones activas', async () => {
      const { repository, models } = build();
      await repository.findAttributeDefinitionsByCode(['ingreso_mensual']);
      expect(firstArg(models.definition.findAll as jest.Mock)).toMatchObject({
        where: { attributeCode: { [Op.in]: ['ingreso_mensual'] }, isActive: true },
      });
    });

    /** Sin definiciones no hay nada que buscar: preguntarlo igual sería un viaje a la base para nada. */
    it('no consulta valores cuando no hay definiciones', async () => {
      const { repository, models } = build();
      await expect(repository.findCurrentAttributeValues('t1', 'c1', [])).resolves.toEqual([]);
      expect(models.attributeValue.findAll).not.toHaveBeenCalled();
    });

    it('los valores vigentes son los que no tienen cierre', async () => {
      const { repository, models } = build();
      await repository.findCurrentAttributeValues('t1', 'c1', ['d1'], { transaction });
      expect(firstArg(models.attributeValue.findAll as jest.Mock)).toMatchObject({
        where: { tenantId: 't1', customerId: 'c1', attributeDefinitionId: { [Op.in]: ['d1'] }, validUntil: null },
      });
    });

    it('cerrar un valor no lo sobrescribe: la tabla es append-only', async () => {
      const { repository } = build();
      const value = { validUntil: null as Date | null, save: jest.fn(async (..._args: unknown[]) => undefined) };
      await repository.closeAttributeValue(value as never, now, { transaction });
      expect(value.validUntil).toBe(now);
      expect(value.save).toHaveBeenCalledWith({ transaction });
    });
  });

  describe('referencias personales', () => {
    it('se listan sin las borradas y en orden estable', async () => {
      const { repository, models } = build();
      await repository.findReferenceContacts('t1', 'c1');
      expect(firstArg(models.reference.findAll as jest.Mock)).toMatchObject({
        where: { tenantId: 't1', customerId: 'c1', deleted: { [Op.ne]: true } },
        order: [['id', 'ASC']],
      });
    });

    it('la búsqueda por teléfono va por HASH, nunca por el número en claro', async () => {
      const { repository, models } = build();
      await repository.findReferenceByPhoneHash('t1', 'c1', 'hash-1');
      expect(firstArg(models.reference.findOne as jest.Mock)).toMatchObject({
        where: { tenantId: 't1', customerId: 'c1', phoneHash: 'hash-1', deleted: { [Op.ne]: true } },
      });
    });

    it('una referencia nueva nace sin contactar y sin verificar', async () => {
      const { repository, models } = build();
      await repository.createReferenceContact(
        {
          tenantId: 't1',
          customerId: 'c1',
          relationshipType: 'family',
          fullNameHash: 'h',
          fullNameEncrypted: null,
          phoneHash: 'ph',
          phoneEncrypted: null,
          phoneLast4: '1234',
          consentBasis: 'declared',
          createdAt: now,
        },
        { transaction },
      );
      expect(firstArg(models.reference.create as jest.Mock)).toMatchObject({
        referenceNotified: false,
        contactabilityStatus: 'not_contacted',
        verificationStatus: 'declared',
        deleted: false,
      });
    });

    it('el borrado es lógico: la referencia se marca, no desaparece', async () => {
      const { repository } = build();
      const reference = { deleted: false, updatedAtValue: null, save: jest.fn(async () => undefined) };
      await repository.softDeleteReference(reference as never, now, { transaction });
      expect(reference.deleted).toBe(true);
      expect(reference.updatedAtValue).toBe(now);
    });
  });

  describe('métodos de contacto', () => {
    it('se buscan por hash del valor, sin los borrados', async () => {
      const { repository, models } = build();
      await repository.findContactMethodByHash('t1', 'c1', 'hash-1', { transaction });
      expect(firstArg(models.contactMethod.findOne as jest.Mock)).toMatchObject({
        where: { tenantId: 't1', customerId: 'c1', contactValueHash: 'hash-1', deleted: { [Op.ne]: true } },
      });
    });

    it('el contacto añadido después del registro se crea con su etiqueta y su transacción', async () => {
      const { repository, models } = build();
      await repository.createContactMethod(
        {
          tenantId: 't1',
          customerId: 'c1',
          contactType: 'phone',
          contactValueHash: 'hash-1',
          contactValueEncrypted: 'sobre',
          valueLast4: '9876',
          emailDomain: null,
          label: 'secondary_phone',
          createdAt: now,
        },
        { transaction },
      );
      expect(firstArg(models.contactMethod.create as jest.Mock)).toMatchObject({
        contactType: 'phone',
        contactValueHash: 'hash-1',
        label: 'secondary_phone',
      });
      expect((models.contactMethod.create as jest.Mock).mock.calls[0][1]).toEqual({ transaction });
    });
  });
});
