/**
 * @file Verifica el origen (sucursal y caja) de cada compra y los movimientos de caja del comercio.
 * @business Dos compras del mismo importe en cajas distintas se distinguen por su caja; una compra sin QR físico no
 *   inventa una.
 * @system Prueba CreditPosOriginService con dobles del modelo de solicitudes y del directorio de cajas.
 */
import { describe, expect, it, jest } from '@jest/globals';
import { CreditPosOriginService, origenDe, SIN_ORIGEN } from '../../../src/modules/credit/application/credit-pos-origin.service.js';

const directorio = new Map([
  ['5', { branchId: '1', branchName: 'Equipetrol', branchCode: 'EQ', terminalAlias: 'Caja 1', terminalSerial: 'SN-5' }],
  ['6', { branchId: '2', branchName: 'Centro', branchCode: 'CE', terminalAlias: null, terminalSerial: 'SN-6' }],
]);

function montar(filas: Record<string, unknown>[][]) {
  const findAll = jest.fn(async (..._a: unknown[]) => filas.shift() ?? []);
  const service = new CreditPosOriginService(
    { findAll } as never,
    { terminalDirectory: jest.fn(async () => directorio) } as never,
    { requireProfile: jest.fn(async () => ({ ownerMerchantUserId: 'm1' })) } as never,
  );
  return { service, findAll };
}

describe('CreditPosOriginService', () => {
  it('asegurarComercio: el dueño pasa, otro comercio no', async () => {
    const { service } = montar([]);
    await expect(
      service.asegurarComercio('1', '2', { sub: 'm1', merchantUserId: 'm1', role: 'merchant' } as never),
    ).resolves.toBeUndefined();
    await expect(service.asegurarComercio('1', '2', { sub: 'm9', merchantUserId: 'm9', role: 'merchant' } as never)).rejects.toThrow();
  });

  it('origenDe: caja conocida, caja borrada y compra sin caja', () => {
    expect(origenDe('5', directorio as never)).toEqual({
      branchId: '1',
      branchName: 'Equipetrol',
      branchCode: 'EQ',
      terminalId: '5',
      terminalAlias: 'Caja 1',
      terminalSerial: 'SN-5',
    });
    expect(origenDe('99', directorio as never)).toEqual({ ...SIN_ORIGEN, terminalId: '99' });
    expect(origenDe(null, directorio as never)).toEqual(SIN_ORIGEN);
  });

  it('cajas: sucursales únicas y cajas ordenadas para los filtros', async () => {
    const { service } = montar([]);
    const r = await service.cajas('1', '2');
    expect(r.branches.map((b) => b.branchName)).toEqual(['Centro', 'Equipetrol']);
    expect(r.terminals.map((t) => t.terminalId)).toEqual(['5', '6']);
  });

  it('origenes: por id de solicitud, sin consultar si no hay ids', async () => {
    const { service, findAll } = montar([[{ id: '10', posTerminalId: '6' }]]);
    expect((await service.origenes('1', '2', [])).size).toBe(0);
    expect(findAll).not.toHaveBeenCalled();
    const r = await service.origenes('1', '2', ['10', '10']);
    expect(r.get('10')?.branchName).toBe('Centro');
  });

  it('movimientos: solicitudes respondidas y pagos iniciales verificados, cada uno con su caja', async () => {
    const t = new Date('2026-10-08T15:00:00.000Z');
    const { service, findAll } = montar([
      [
        {
          id: '10',
          applicationCode: 'APP-10',
          requestedAmount: '480.00',
          currencyCode: 'BOB',
          businessAcceptance: 'accepted',
          requestedTermMonths: 2,
          businessAcceptanceAt: t,
          posTerminalId: '5',
        },
      ],
      [
        {
          id: '10',
          applicationCode: 'APP-10',
          downPaymentAmount: '720.00',
          currencyCode: 'BOB',
          downPaymentStatus: 'confirmed',
          downPaymentPayerReference: 'REF',
          downPaymentDecidedAt: t,
          posTerminalId: '5',
        },
      ],
    ]);
    const r = await service.movimientos('1', '2', { from: new Date('2026-10-01'), to: null });
    expect(r.map((m) => [m.kind, m.amount, m.terminalAlias])).toEqual([
      ['purchase_request', 480, 'Caja 1'],
      ['down_payment', 720, 'Caja 1'],
    ]);
    expect(JSON.stringify(findAll.mock.calls[0])).toContain('businessAcceptanceAt');
  });
});
