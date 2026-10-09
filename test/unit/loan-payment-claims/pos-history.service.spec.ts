/**
 * @file Verifica el historial del POS: filtros por sucursal y caja, orden, páginas, total del filtro y origen de cada
 *   comprobante de cuota.
 * @business El comercio cuadra su caja por sucursal, caja y días; dos pagos iguales de cajas distintas no se confunden.
 * @system Prueba PosHistoryService y sus funciones puras con dobles de modelos y del servicio de origen.
 */
import { describe, expect, it, jest } from '@jest/globals';
import { posHistoryQuerySchema } from '../../../src/modules/loan-payment-claims/loan-payment-claims.schemas.js';
import {
  paginarMovimientos,
  PosHistoryService,
  rangoDeDias,
  type MovimientoDePos,
} from '../../../src/modules/loan-payment-claims/pos-history.service.js';

const mov = (
  id: string,
  happenedAt: string,
  terminalId: string,
  branchId: string,
  amount = 100,
  status = 'confirmed',
): MovimientoDePos => ({
  kind: 'down_payment',
  id,
  code: id,
  amount,
  currencyCode: 'BOB',
  status,
  reference: null,
  termMonths: null,
  happenedAt,
  branchId,
  branchName: `S${branchId}`,
  branchCode: null,
  terminalId,
  terminalAlias: `Caja ${terminalId}`,
  terminalSerial: null,
});

describe('historial del POS', () => {
  const lista = [
    mov('a', '2026-10-08T10:00:00.000Z', '5', '1', 240),
    mov('b', '2026-10-08T12:00:00.000Z', '6', '2', 240),
    mov('c', '2026-10-07T09:00:00.000Z', '5', '1', 100, 'rejected'),
  ];

  it('filtra por caja y por sucursal, de lo más reciente a lo más antiguo', () => {
    expect(paginarMovimientos(lista, { page: 1, pageSize: 20 }).items.map((m) => m.id)).toEqual(['b', 'a', 'c']);
    expect(paginarMovimientos(lista, { terminalId: '5', page: 1, pageSize: 20 }).items.map((m) => m.id)).toEqual(['a', 'c']);
    expect(paginarMovimientos(lista, { branchId: '2', page: 1, pageSize: 20 }).items.map((m) => m.id)).toEqual(['b']);
  });

  it('pagina y el total es del FILTRO, sin contar lo rechazado en el importe', () => {
    const r = paginarMovimientos(lista, { page: 2, pageSize: 2 });
    expect(r.items.map((m) => m.id)).toEqual(['c']);
    expect({ total: r.total, pages: r.pages, page: r.page }).toEqual({ total: 3, pages: 2, page: 2 });
    expect(r.totals).toEqual({ count: 3, amount: '480.00' });
    expect(paginarMovimientos(lista, { page: 9, pageSize: 2 }).page).toBe(2);
  });

  it('los días son de Bolivia (UTC−4), no de UTC', () => {
    const r = rangoDeDias('2026-10-08', '2026-10-08');
    expect(r.from?.toISOString()).toBe('2026-10-08T04:00:00.000Z');
    expect(r.to?.toISOString()).toBe('2026-10-09T03:59:59.999Z');
    expect(rangoDeDias()).toEqual({ from: null, to: null });
  });

  it('el esquema rechaza un rango al revés y acota la página', () => {
    expect(posHistoryQuerySchema.safeParse({ from: '2026-10-09', to: '2026-10-08' }).success).toBe(false);
    expect(posHistoryQuerySchema.parse({})).toEqual({ page: 1, pageSize: 20 });
    expect(posHistoryQuerySchema.safeParse({ pageSize: '500' }).success).toBe(false);
  });

  function montar() {
    const claims = {
      findAll: jest.fn(async (..._a: unknown[]) => [
        {
          id: '30',
          installmentId: '300',
          claimCode: 'CLM-30',
          claimedAmount: '240.00',
          currencyCode: 'BOB',
          status: 'verified',
          payerReference: 'R',
          decidedAt: new Date('2026-10-08T14:00:00.000Z'),
        },
      ]),
    };
    const installments = { findAll: jest.fn(async (..._a: unknown[]) => [{ id: '300', loanId: '3' }]) };
    const loans = { findAll: jest.fn(async (..._a: unknown[]) => [{ id: '3', creditApplicationId: '10' }]) };
    const posOrigin = {
      movimientos: jest.fn(async (..._a: unknown[]) => [mov('inicial-10', '2026-10-08T13:00:00.000Z', '5', '1', 720)]),
      cajas: jest.fn(async (..._a: unknown[]) => ({ branches: [], terminals: [] })),
      asegurarComercio: jest.fn(async (..._a: unknown[]) => undefined),
      origenes: jest.fn(
        async (..._a: unknown[]) =>
          new Map([
            ['10', { branchId: '2', branchName: 'S2', branchCode: 'CE', terminalId: '6', terminalAlias: 'Caja 6', terminalSerial: null }],
          ]),
      ),
    };
    const service = new PosHistoryService(claims as never, installments as never, loans as never, posOrigin as never);
    return { service, posOrigin };
  }
  const comercio = { sub: 'm1', merchantUserId: 'm1', role: 'merchant', tenantId: '1' } as never;

  it('junta pagos iniciales y cuotas; cada cuota sale con la caja de la compra de su crédito', async () => {
    const { service } = montar();
    const r = await service.history({ tenantId: '1', partnerProfileId: '2', currentUser: comercio, filtro: { page: 1, pageSize: 20 } });
    expect(r.items.map((m) => [m.id, m.terminalId, m.branchName])).toEqual([
      ['cuota-30', '6', 'S2'],
      ['inicial-10', '5', 'S1'],
    ]);
    expect(r.items[0]?.kind).toBe('installment_payment');
  });

  it('origenDeComprobantes sin comprobantes no consulta nada', async () => {
    const { service, posOrigin } = montar();
    expect((await service.origenDeComprobantes('1', '2', [])).size).toBe(0);
    expect(posOrigin.origenes).not.toHaveBeenCalled();
  });
});
