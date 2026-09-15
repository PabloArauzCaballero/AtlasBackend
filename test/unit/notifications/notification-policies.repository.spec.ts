import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { NotFoundException } from '@nestjs/common';
import { NotificationPoliciesRepository } from '../../../src/modules/notifications/notification-policies.repository.js';
import type { NotificationPolicyModel } from '../../../src/database/models/index.js';

/**
 * El catálogo de avisos, del lado del SERVIDOR.
 *
 * Antes la obligatoriedad de un aviso llegaba en el cuerpo de la petición del cliente: bastaba
 * mandar `isRequired: false` para poder apagar el recordatorio de pago y el aviso de mora. El
 * control existía y no controlaba nada. La respuesta a «¿esto se puede apagar?» sale ahora de aquí,
 * donde la escribe operaciones y no la app — y eso es lo que fijan estas pruebas.
 *
 * Un aviso OBLIGATORIO no puede quedar apagado por defecto: sería obligatorio y silencioso a la vez.
 * La base también lo impide, y aquí se corrige antes de llegar a ella para que el portal reciba el
 * dato coherente en lugar de un error de restricción.
 *
 * Y los pares obligatorios se devuelven como CONJUNTO porque quien los usa comprueba pertenencia
 * una vez por preferencia recibida: una consulta por preferencia convertiría un `PATCH` de veinte
 * filas en veinte viajes a la base.
 */
function politica(overrides: Record<string, unknown> = {}) {
  return {
    id: 'np-1',
    eventCode: 'PAYMENT_DUE',
    channel: 'push',
    label: 'Recordatorio de pago',
    description: 'Te avisamos antes del vencimiento',
    category: 'pagos',
    icon: 'bell',
    isMandatory: false,
    defaultEnabled: true,
    mandatoryReason: null,
    displayOrder: 10,
    isActive: true,
    updatedByInternalUserId: null,
    save: jest.fn(async () => undefined),
    ...overrides,
  } as unknown as NotificationPolicyModel;
}

describe('NotificationPoliciesRepository', () => {
  let model: { findAll: jest.Mock; findOne: jest.Mock; create: jest.Mock };
  let repo: NotificationPoliciesRepository;

  beforeEach(() => {
    model = {
      findAll: jest.fn(async () => []),
      findOne: jest.fn(async () => null),
      create: jest.fn(async (values: unknown) => politica(values as Record<string, unknown>)),
    };
    repo = new NotificationPoliciesRepository(model as unknown as typeof NotificationPolicyModel);
  });

  function ultima(mock: jest.Mock): { where: Record<string, unknown>; order?: unknown[]; attributes?: string[] } {
    return mock.mock.calls.at(-1)?.[0] as { where: Record<string, unknown> };
  }

  describe('listados', () => {
    it('lo que ve la app es sólo lo ACTIVO, en el orden en que se pinta', async () => {
      await repo.listActive('t1');

      expect(ultima(model.findAll).where).toEqual({ tenantId: 't1', isActive: true, deleted: false });
      expect(ultima(model.findAll).order).toEqual([
        ['category', 'ASC'],
        ['displayOrder', 'ASC'],
        ['eventCode', 'ASC'],
      ]);
    });

    it('el portal interno ve TAMBIÉN lo apagado: tiene que poder reactivar lo que apagó', async () => {
      await repo.listAll('t1');

      expect(ultima(model.findAll).where).toEqual({ tenantId: 't1', deleted: false });
      expect(ultima(model.findAll).where).not.toHaveProperty('isActive');
    });

    it('una política se localiza por la pareja evento+canal, dentro del tenant', async () => {
      await repo.find('t1', 'PAYMENT_DUE', 'push');

      expect(ultima(model.findOne).where).toEqual({ tenantId: 't1', eventCode: 'PAYMENT_DUE', channel: 'push', deleted: false });
    });
  });

  describe('los avisos que no se pueden apagar', () => {
    it('salen como CONJUNTO de pares: una consulta por preferencia serían veinte viajes', async () => {
      model.findAll.mockResolvedValueOnce([
        politica({ eventCode: 'PAYMENT_DUE', channel: 'push' }),
        politica({ eventCode: 'PAYMENT_OVERDUE', channel: 'sms' }),
      ] as never);

      const claves = await repo.mandatoryKeys('t1');

      expect(claves).toBeInstanceOf(Set);
      expect(claves.has('PAYMENT_DUE:push')).toBe(true);
      expect(claves.has('PAYMENT_OVERDUE:sms')).toBe(true);
      expect(claves.has('MARKETING:push')).toBe(false);
    });

    it('sólo cuentan las obligatorias Y activas: una apagada ya no obliga a nadie', async () => {
      await repo.mandatoryKeys('t1');

      expect(ultima(model.findAll).where).toEqual({ tenantId: 't1', isMandatory: true, isActive: true, deleted: false });
    });

    it('se piden sólo las dos columnas que forman la clave', async () => {
      await repo.mandatoryKeys('t1');

      expect(ultima(model.findAll).attributes).toEqual(['eventCode', 'channel']);
    });

    it('sin ninguna obligatoria el conjunto sale vacío y no nulo', async () => {
      await expect(repo.mandatoryKeys('t1')).resolves.toEqual(new Set());
    });
  });

  describe('crear una política', () => {
    it('nace activa, en la categoría general y al final del orden si no se dice otra cosa', async () => {
      await repo.upsert({ tenantId: 't1', eventCode: 'X', channel: 'push', label: 'Algo' });

      const [values] = model.create.mock.calls.at(-1) as [Record<string, unknown>];
      expect(values).toMatchObject({ category: 'general', displayOrder: 100, isActive: true, isMandatory: false, deleted: false });
      expect(values.createdAtValue).toBeInstanceOf(Date);
    });

    it('una OBLIGATORIA nace encendida aunque se pida apagada: obligatoria y silenciosa a la vez no existe', async () => {
      await repo.upsert({ tenantId: 't1', eventCode: 'X', channel: 'push', label: 'Algo', isMandatory: true, defaultEnabled: false });

      expect((model.create.mock.calls.at(-1)?.[0] as { defaultEnabled: boolean }).defaultEnabled).toBe(true);
    });

    it('una opcional respeta que nazca apagada', async () => {
      await repo.upsert({ tenantId: 't1', eventCode: 'X', channel: 'push', label: 'Algo', isMandatory: false, defaultEnabled: false });

      expect((model.create.mock.calls.at(-1)?.[0] as { defaultEnabled: boolean }).defaultEnabled).toBe(false);
    });

    it('los textos opcionales ausentes se guardan nulos y no como `undefined`', async () => {
      await repo.upsert({ tenantId: 't1', eventCode: 'X', channel: 'push', label: 'Algo' });

      const [values] = model.create.mock.calls.at(-1) as [Record<string, unknown>];
      for (const clave of ['description', 'icon', 'mandatoryReason', 'updatedByInternalUserId']) {
        expect(values[clave]).toBeNull();
      }
    });
  });

  describe('actualizar una política', () => {
    it('lo que no llega se CONSERVA: un guardado parcial no borra la descripción de nadie', async () => {
      const existente = politica({ description: 'texto largo', icon: 'bell', displayOrder: 10 });
      model.findOne.mockResolvedValueOnce(existente as never);

      await repo.upsert({ tenantId: 't1', eventCode: 'PAYMENT_DUE', channel: 'push', label: 'Nuevo rótulo' });

      expect(existente.label).toBe('Nuevo rótulo');
      expect(existente.description).toBe('texto largo');
      expect(existente.icon).toBe('bell');
      expect(existente.displayOrder).toBe(10);
      expect(model.create).not.toHaveBeenCalled();
    });

    it('marcarla obligatoria la enciende, aunque estuviera apagada', async () => {
      const existente = politica({ isMandatory: false, defaultEnabled: false });
      model.findOne.mockResolvedValueOnce(existente as never);

      await repo.upsert({ tenantId: 't1', eventCode: 'PAYMENT_DUE', channel: 'push', label: 'x', isMandatory: true });

      expect(existente.isMandatory).toBe(true);
      expect(existente.defaultEnabled).toBe(true);
    });

    it('una que YA era obligatoria no se puede dejar apagada por defecto', async () => {
      const existente = politica({ isMandatory: true, defaultEnabled: true });
      model.findOne.mockResolvedValueOnce(existente as never);

      await repo.upsert({ tenantId: 't1', eventCode: 'PAYMENT_DUE', channel: 'push', label: 'x', defaultEnabled: false });

      expect(existente.defaultEnabled).toBe(true);
    });

    it('dejar de ser obligatoria sí permite apagarla', async () => {
      const existente = politica({ isMandatory: true, defaultEnabled: true });
      model.findOne.mockResolvedValueOnce(existente as never);

      await repo.upsert({
        tenantId: 't1',
        eventCode: 'PAYMENT_DUE',
        channel: 'push',
        label: 'x',
        isMandatory: false,
        defaultEnabled: false,
      });

      expect(existente.isMandatory).toBe(false);
      expect(existente.defaultEnabled).toBe(false);
    });

    it('queda escrito quién la tocó y cuándo', async () => {
      const existente = politica();
      model.findOne.mockResolvedValueOnce(existente as never);

      await repo.upsert({ tenantId: 't1', eventCode: 'PAYMENT_DUE', channel: 'push', label: 'x', updatedByInternalUserId: '7' });

      expect(existente.updatedByInternalUserId).toBe('7');
      expect(existente.updatedAtValue).toBeInstanceOf(Date);
      expect(existente.save).toHaveBeenCalled();
    });
  });

  describe('exigir una política', () => {
    it('una que no existe es 404 con el código del dominio', async () => {
      await expect(repo.requireById('t1', 'np-9')).rejects.toBeInstanceOf(NotFoundException);
    });

    it('se busca dentro del tenant y entre lo no borrado', async () => {
      model.findOne.mockResolvedValueOnce(politica() as never);

      await repo.requireById('t1', 'np-1');

      expect(ultima(model.findOne).where).toEqual({ id: 'np-1', tenantId: 't1', deleted: false });
    });
  });
});
