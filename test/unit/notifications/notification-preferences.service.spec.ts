import { describe, expect, it, jest } from '@jest/globals';
import { NotificationPreferencesService } from '../../../src/modules/notifications/notification-preferences.service.js';

describe('NotificationPreferencesService', () => {
  function build() {
    const preferences = {
      getPreferences: jest.fn(async (..._args: unknown[]) => []),
      upsertPreferences: jest.fn(async (..._args: unknown[]) => []),
    };
    // El catalogo de politicas: es de donde salen el nombre, la explicacion y la obligatoriedad de cada aviso.
    const policies = { listActive: jest.fn(async (..._args: unknown[]) => []) };
    return { service: new NotificationPreferencesService(preferences as never, policies as never), preferences, policies };
  }

  it('updatePreferences guarda y responde con la MISMA forma que la lectura', async () => {
    const { service, preferences, policies } = build();
    await service.updatePreferences('1', '9', { preferences: [] } as never);
    expect(preferences.upsertPreferences).toHaveBeenCalledTimes(1);
    // La lectura del catalogo ocurre una vez: la que devuelve `updatePreferences` para que la app repinte.
    expect(policies.listActive).toHaveBeenCalledTimes(1);
  });

  /*
   * La pantalla de avisos del cliente no ofrece un interruptor para un aviso que nadie envía. La mora y el
   * vencimiento no se avisan al deudor (decisión de producto pendiente): ofrecer «Tu cuota venció» como
   * aviso obligatorio prometía algo que ningún código cumplía.
   */
  it('getPreferences no ofrece las políticas cuyo aviso no se envía (cuota por vencer, cuota vencida)', async () => {
    const { service, policies, preferences } = build();
    const politica = (eventCode: string, isMandatory = false) => ({
      eventCode,
      channel: 'push',
      label: eventCode,
      description: null,
      category: 'pagos',
      icon: null,
      isMandatory,
      mandatoryReason: isMandatory ? 'razón' : null,
      defaultEnabled: true,
      displayOrder: 10,
    });
    (policies.listActive as jest.Mock).mockResolvedValueOnce([
      politica('cuota_por_vencer'),
      politica('cuota_vencida', true),
      politica('pago_acreditado', true),
    ] as never);
    // Lo que el cliente ya había elegido para un aviso retirado no se borra ni se enseña como «legado».
    (preferences.getPreferences as jest.Mock).mockResolvedValueOnce([
      { eventCode: 'cuota_vencida', channel: 'push', isEnabled: true, isRequired: true },
    ] as never);

    const result = await service.getPreferences('1', '9');

    expect(result.data.map((item) => item.eventCode)).toEqual(['pago_acreditado']);
    expect(result.legacy).toHaveLength(0);
  });
});
