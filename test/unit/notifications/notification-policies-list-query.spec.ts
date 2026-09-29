import { describe, expect, it } from '@jest/globals';
import { listNotificationPoliciesQuerySchema } from '../../../src/modules/notifications/notification-policies-operations.controller.js';

describe('listNotificationPoliciesQuerySchema', () => {
  it('sin page ni limit no pagina: el cliente anterior sigue recibiendo el catálogo entero', () => {
    expect(listNotificationPoliciesQuerySchema.parse({})).toEqual({ page: 1, limit: undefined });
  });

  it('con page y sin limit pagina de 20 en 20', () => {
    expect(listNotificationPoliciesQuerySchema.parse({ page: '2' })).toEqual({ page: 2, limit: 20 });
  });

  it('lee los filtros, los booleanos de texto y recorta el buscador', () => {
    expect(
      listNotificationPoliciesQuerySchema.parse({
        q: '  mora ',
        channel: 'sms',
        category: 'pagos',
        mandatory: 'false',
        active: '1',
        limit: '50',
      }),
    ).toEqual({ q: 'mora', channel: 'sms', category: 'pagos', mandatory: false, active: true, page: 1, limit: 50 });
  });

  it('rechaza canal desconocido, limit fuera de rango y booleano ambiguo', () => {
    expect(() => listNotificationPoliciesQuerySchema.parse({ channel: 'fax' })).toThrow();
    expect(() => listNotificationPoliciesQuerySchema.parse({ limit: '101' })).toThrow();
    expect(() => listNotificationPoliciesQuerySchema.parse({ mandatory: 'quizá' })).toThrow();
  });
});
