import { CreditController } from '../../../src/modules/credit/credit.controller.js';
import { toCreditLineResponse } from '../../../src/modules/credit/credit-line.mapper.js';

/**
 * Pablo (2026-10-08): «una cosa es el aprobado y otra lo que aún me queda disponible». Con un préstamo de Bs 480 vivo
 * sobre una línea de Bs 900, la app decía «Disponible Bs 900» y «Por pagar Bs 0»: nadie le pasaba lo comprometido.
 */
const linea = { customerId: '60', currencyCode: 'BOB', approvedLimit: '900.00', scoring: 50 } as never;

describe('crédito disponible', () => {
  it('disponible = aprobado − comprometido; nunca negativo', () => {
    expect(toCreditLineResponse(linea, 480)).toMatchObject({ approvedLimit: 900, used: 480, available: 420 });
    expect(toCreditLineResponse(linea, 1_000)).toMatchObject({ used: 1_000, available: 0 });
  });

  it('GET credit-line descuenta lo que el cliente ya debe', async () => {
    const creditLines = { currentOrRequest: jest.fn(async () => linea) };
    const exposure = { exposureOf: jest.fn(async () => 480) };
    const controller = new CreditController({} as never, {} as never, creditLines as never, {} as never, exposure as never);

    const r = await controller.creditLine('1', { customerId: '60' } as never, { role: 'customer', customerId: '60', sub: 'u60' } as never);

    expect(exposure.exposureOf).toHaveBeenCalledWith('1', '60');
    expect(r).toMatchObject({ approvedLimit: 900, used: 480, available: 420 });
  });
});

describe('ExposureReservationService.exposureOf', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { ExposureReservationService } = require('../../../src/modules/credit/application/exposure-reservation.service.js');

  it('suma préstamos vivos y reservas vigentes en una consulta, y devuelve un número', async () => {
    const sequelize = { query: jest.fn(async () => [{ total: '480.00' }]) };
    const servicio = new ExposureReservationService({} as never, sequelize as never);
    await expect(servicio.exposureOf('1', '60', new Date('2026-10-08T12:00:00Z'))).resolves.toBe(480);
    const [sql, opciones] = sequelize.query.mock.calls[0] as unknown as [string, { bind: Record<string, unknown> }];
    expect(sql).toMatch(/outstanding_principal/);
    expect(sql).toMatch(/credit_exposure_reservations/);
    expect(opciones.bind).toMatchObject({ tenantId: '1', customerId: '60' });
  });

  it('sin filas o con basura, cero', async () => {
    const servicio = new ExposureReservationService({} as never, { query: jest.fn(async () => []) } as never);
    await expect(servicio.exposureOf('1', '60')).resolves.toBe(0);
  });
});
