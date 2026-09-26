import { describe, expect, it, jest } from '@jest/globals';
import { NotificationPreferencesRepository } from '../../../src/modules/notifications/notification-preferences.repository.js';

/**
 * Cobertura directa de `NotificationPreferencesRepository`.
 *
 * ## Qué cambió, y por qué estas pruebas también
 *
 * La obligatoriedad de un aviso llegaba EN EL CUERPO DE LA PETICIÓN del cliente. Para quien nunca
 * había tocado la pantalla no existía fila previa, así que bastaba enviar `isRequired: false` junto
 * a `isEnabled: false` para apagar el recordatorio de cuota o el aviso de mora — justamente los dos
 * que no se pueden apagar. La comprobación miraba la fila que el propio llamante acababa de
 * fabricar, así que el control se ejercía sobre el dato de quien quería saltárselo.
 *
 * Ahora la respuesta a «¿esto se puede apagar?» sale del catálogo de políticas del servidor. Las
 * pruebas de abajo fijan las dos mitades: que el catálogo manda, y que lo que mande el cliente en
 * `isRequired` es irrelevante.
 */
describe('NotificationPreferencesRepository', () => {
  function buildRepo(options: { mandatory?: string[]; policy?: Record<string, unknown> | null } = {}) {
    const preferenceModel = { findAll: jest.fn(), findOne: jest.fn(), create: jest.fn() };
    const policies = {
      mandatoryKeys: jest.fn(async () => new Set(options.mandatory ?? [])),
      find: jest.fn(async () => options.policy ?? null),
    };
    const repo = new NotificationPreferencesRepository(preferenceModel as never, policies as never);
    return { repo, preferenceModel, policies };
  }

  it('getPreferences filtra por tenant+cliente y ordena por eventCode/channel', async () => {
    const { repo, preferenceModel } = buildRepo();
    (preferenceModel.findAll as jest.Mock).mockResolvedValue([] as never);
    await repo.getPreferences('t1', 'c1');
    const arg = (preferenceModel.findAll as jest.Mock).mock.calls[0][0] as { where: Record<string, unknown>; order: unknown };
    expect(arg.where).toEqual({ tenantId: 't1', customerId: 'c1' });
    expect(arg.order).toEqual([
      ['eventCode', 'ASC'],
      ['channel', 'ASC'],
    ]);
  });

  it('upsertPreferences lanza si el CATÁLOGO marca el aviso como obligatorio', async () => {
    const { repo, preferenceModel } = buildRepo({ mandatory: ['e:push'] });
    (preferenceModel.findOne as jest.Mock).mockResolvedValue(null as never);
    await expect(
      repo.upsertPreferences('t1', 'c1', {
        preferences: [{ eventCode: 'e', channel: 'push', isEnabled: false, isRequired: false }],
      } as never),
    ).rejects.toThrow('REQUIRED_NOTIFICATION_CANNOT_BE_DISABLED');
  });

  /*
   * El agujero, fijado como prueba.
   *
   * Sin fila previa y con `isRequired: false` en el cuerpo, la versión anterior creaba la
   * preferencia apagada sin protestar. Es el camino exacto por el que se podía silenciar el aviso
   * de mora, así que merece su propia prueba y no quedar cubierto de refilón por la de arriba.
   */
  it('un cliente sin preferencia previa NO puede apagar un aviso obligatorio enviando isRequired=false', async () => {
    const { repo, preferenceModel } = buildRepo({ mandatory: ['payment_overdue:push'] });
    (preferenceModel.findOne as jest.Mock).mockResolvedValue(null as never);
    await expect(
      repo.upsertPreferences('t1', 'c1', {
        preferences: [{ eventCode: 'payment_overdue', channel: 'push', isEnabled: false, isRequired: false }],
      } as never),
    ).rejects.toThrow('REQUIRED_NOTIFICATION_CANNOT_BE_DISABLED');
    expect(preferenceModel.create).not.toHaveBeenCalled();
  });

  it('lo que el cliente mande en isRequired se ignora: manda el catálogo', async () => {
    const { repo, preferenceModel } = buildRepo({ mandatory: [] });
    (preferenceModel.findOne as jest.Mock).mockResolvedValue(null as never);
    (preferenceModel.create as jest.Mock).mockResolvedValue({} as never);
    (preferenceModel.findAll as jest.Mock).mockResolvedValue([] as never);
    await repo.upsertPreferences('t1', 'c1', {
      preferences: [{ eventCode: 'e', channel: 'sms', isEnabled: true, isRequired: true }],
    } as never);
    // Enviado `true`, guardado `false`: la app no puede declarar su propia obligatoriedad.
    expect((preferenceModel.create as jest.Mock).mock.calls[0][0]).toMatchObject({ isRequired: false });
  });

  it('isRequired se REESCRIBE con el catálogo en vez de acumularse', async () => {
    const { repo, preferenceModel } = buildRepo({ mandatory: [] });
    const save = jest.fn(async (..._args: unknown[]) => ({}));
    const existing = { isRequired: true, isEnabled: true, save } as never;
    (preferenceModel.findOne as jest.Mock).mockResolvedValue(existing as never);
    (preferenceModel.findAll as jest.Mock).mockResolvedValue([] as never);
    await repo.upsertPreferences('t1', 'c1', {
      preferences: [{ eventCode: 'e', channel: 'push', isEnabled: true, isRequired: false }],
    } as never);
    // Con el `||` anterior, un aviso marcado obligatorio una vez lo era para siempre: si operaciones
    // deja de considerarlo irrenunciable, la fila del cliente tiene que dejar de estar bloqueada.
    expect((existing as { isRequired: boolean }).isRequired).toBe(false);
    expect(save).toHaveBeenCalled();
    expect(preferenceModel.create).not.toHaveBeenCalled();
  });

  it('upsertPreferences crea la preferencia cuando no existe', async () => {
    const { repo, preferenceModel } = buildRepo();
    (preferenceModel.findOne as jest.Mock).mockResolvedValue(null as never);
    (preferenceModel.create as jest.Mock).mockResolvedValue({} as never);
    (preferenceModel.findAll as jest.Mock).mockResolvedValue([] as never);
    await repo.upsertPreferences('t1', 'c1', {
      preferences: [{ eventCode: 'e', channel: 'sms', isEnabled: true, isRequired: false }],
    } as never);
    expect((preferenceModel.create as jest.Mock).mock.calls[0][0]).toMatchObject({ eventCode: 'e', channel: 'sms', isEnabled: true });
  });

  it('isChannelEnabled devuelve true de inmediato si required=true (sin consultar)', async () => {
    const { repo, preferenceModel } = buildRepo();
    const result = await repo.isChannelEnabled({
      tenantId: 't1',
      customerId: 'c1',
      eventCode: 'e',
      channel: 'push' as never,
      required: true,
    });
    expect(result).toBe(true);
    expect(preferenceModel.findOne).not.toHaveBeenCalled();
  });

  it('sin política ni preferencia el canal se considera habilitado (opt-out)', async () => {
    const { repo, preferenceModel } = buildRepo({ policy: null });
    (preferenceModel.findOne as jest.Mock).mockResolvedValue(null as never);
    const result = await repo.isChannelEnabled({ tenantId: 't1', customerId: 'c1', eventCode: 'e', channel: 'push' as never });
    expect(result).toBe(true);
  });

  it('sin preferencia guardada manda el valor por defecto de la política', async () => {
    const { repo, preferenceModel } = buildRepo({ policy: { isMandatory: false, isActive: true, defaultEnabled: false } });
    (preferenceModel.findOne as jest.Mock).mockResolvedValue(null as never);
    const result = await repo.isChannelEnabled({ tenantId: 't1', customerId: 'c1', eventCode: 'e', channel: 'push' as never });
    expect(result).toBe(false);
  });

  it('isChannelEnabled respeta isEnabled=false cuando existe preferencia no requerida', async () => {
    const { repo, preferenceModel } = buildRepo({ policy: { isMandatory: false, isActive: true, defaultEnabled: true } });
    (preferenceModel.findOne as jest.Mock).mockResolvedValue({ isRequired: false, isEnabled: false } as never);
    const result = await repo.isChannelEnabled({ tenantId: 't1', customerId: 'c1', eventCode: 'e', channel: 'push' as never });
    expect(result).toBe(false);
  });

  /*
   * El caso que la fila del cliente no puede resolver sola: operaciones declara obligatorio un aviso
   * DESPUÉS de que alguien lo apagara. Su fila sigue diciendo `false`, y sin mirar el catálogo
   * seguiría sin avisarle de una deuda suya.
   */
  it('una política obligatoria sobrescribe una preferencia apagada anterior', async () => {
    const { repo, preferenceModel } = buildRepo({ policy: { isMandatory: true, isActive: true, defaultEnabled: true } });
    (preferenceModel.findOne as jest.Mock).mockResolvedValue({ isRequired: false, isEnabled: false } as never);
    const result = await repo.isChannelEnabled({ tenantId: 't1', customerId: 'c1', eventCode: 'e', channel: 'push' as never });
    expect(result).toBe(true);
  });
});
