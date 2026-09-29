import { describe, expect, it, jest } from '@jest/globals';
import { ROLES_KEY } from '../../../src/common/decorators/roles.decorator.js';
import { operationsClaimsQuerySchema } from '../../../src/modules/loan-payment-claims/loan-payment-claims.schemas.js';
import { OperationsPaymentClaimsController } from '../../../src/modules/loan-payment-claims/operations-payment-claims.controller.js';
import {
  OperationsPaymentClaimsService,
  PAYMENT_CLAIM_STALE_AFTER_HOURS,
  supervisar,
} from '../../../src/modules/loan-payment-claims/operations-payment-claims.service.js';

/**
 * La cola de avisos de pago vista por operaciones (B4). Se fija lo que se equivoca en silencio:
 * un filtro que no llega al SQL, un resumen que cambia con el filtro, una edad medida contra el
 * reloj equivocado y un «atrasado» que marca también lo ya decidido.
 */
const AHORA = new Date('2026-09-26T12:00:00.000Z');

function fila(over: Record<string, unknown> = {}) {
  return {
    claimId: '1',
    claimCode: 'PC-1',
    status: 'pending_verification',
    claimedAmount: '150.00',
    currencyCode: 'BOB',
    payerReference: 'REF-1',
    hasProof: true,
    submittedAt: new Date('2026-09-23T12:00:00.000Z'),
    decidedAt: null,
    rejectionReason: null,
    loanId: '7',
    loanCode: 'L-7',
    installmentId: '70',
    installmentNumber: 2,
    installmentDueDate: '2026-09-20',
    customerId: '9',
    customerCode: 'C-9',
    customerName: 'Ana Pérez',
    partnerId: '3',
    partnerName: 'Tienda Uno',
    ...over,
  };
}

function montar(filas: Record<string, unknown>[] = [fila()], total = '1') {
  const query = jest.fn(async (sql: string, _opciones: { bind: Record<string, unknown> }) => {
    if (sql.includes('FILTER')) return [{ pending: '4', stale: '2' }];
    if (sql.includes('COUNT(*)::text AS total')) return [{ total }];
    return filas;
  });
  const service = new OperationsPaymentClaimsService({ query } as never);
  return { service, query };
}

const consulta = (over: Record<string, unknown> = {}) => operationsClaimsQuerySchema.parse(over);

describe('OperationsPaymentClaimsService · buscador', () => {
  it('q busca por parte en código del aviso, código del cliente y nombre del comercio; el conteo también', async () => {
    const { service, query } = montar();
    await service.list('1', consulta({ q: 'Tienda' }), AHORA);
    const pagina = query.mock.calls.find(([sql]) => sql.includes('LIMIT'))!;
    expect(pagina[0]).toContain('(c.claim_code ILIKE $q OR cu.customer_code ILIKE $q OR p.trade_name ILIKE $q OR p.legal_name ILIKE $q)');
    expect(pagina[1].bind.q).toBe('%Tienda%');
    const conteo = query.mock.calls.find(([sql]) => sql.includes('COUNT(*)::text AS total'))!;
    // Sin los JOIN en el conteo, el total no respetaría la búsqueda.
    expect(conteo[0]).toContain('partner_profiles');
    expect(conteo[0]).toContain('$q');
  });
});

describe('OperationsPaymentClaimsService', () => {
  it('pagina, resume toda la cola y marca como atrasado el pendiente de más de 48 h', async () => {
    const { service } = montar();
    const result = await service.list('1', consulta(), AHORA);

    expect(result.meta).toEqual({ page: 1, pageSize: 25, total: 1, totalPages: 1 });
    expect(result.summary).toEqual({ pending: 4, stalePending: 2, staleAfterHours: PAYMENT_CLAIM_STALE_AFTER_HOURS });
    expect(result.items[0]).toMatchObject({
      claimId: '1',
      loanId: '7',
      customerName: 'Ana Pérez',
      partnerName: 'Tienda Uno',
      submittedAt: '2026-09-23T12:00:00.000Z',
      decidedAt: null,
      ageHours: 72,
      stale: true,
    });
  });

  it('sin filtros sólo acota por tenant y borrado', async () => {
    const { service, query } = montar();
    await service.list('1', consulta({ page: '3', pageSize: '10' }), AHORA);
    const [sql, opciones] = query.mock.calls[0]!;
    expect(sql).toContain('WHERE c._tenant_id = $tenantId AND c._deleted = false\n');
    expect(opciones.bind).toMatchObject({ tenantId: '1', limit: 10, offset: 20 });
    expect(opciones.bind).not.toHaveProperty('status');
  });

  it('cada filtro llega al SQL de la página y del total, pero no al resumen', async () => {
    const { service, query } = montar();
    await service.list('1', consulta({ status: 'rejected', partnerId: '3', customerId: '9', olderThanHours: '24' }), AHORA);
    const [pagina, total, resumen] = query.mock.calls;
    for (const [sql, opciones] of [pagina!, total!]) {
      expect(sql).toContain('c.status = $status');
      expect(sql).toContain('c.partner_profile_id = $partnerId');
      expect(sql).toContain('c.customer_id = $customerId');
      expect(sql).toContain('c.submitted_at < $olderThan');
      expect(opciones.bind).toMatchObject({
        status: 'rejected',
        partnerId: '3',
        customerId: '9',
        olderThan: new Date('2026-09-25T12:00:00.000Z'),
      });
    }
    expect(resumen![0]).not.toContain('$status');
    expect(resumen![1].bind).toEqual({
      tenantId: '1',
      pendiente: 'pending_verification',
      staleCutoff: new Date('2026-09-24T12:00:00.000Z'),
    });
  });

  it('el esquema rechaza estados inventados, ids no numéricos y páginas de más de 100', () => {
    expect(operationsClaimsQuerySchema.safeParse({ status: 'closed' }).success).toBe(false);
    expect(operationsClaimsQuerySchema.safeParse({ partnerId: 'abc' }).success).toBe(false);
    expect(operationsClaimsQuerySchema.safeParse({ pageSize: '101' }).success).toBe(false);
    expect(operationsClaimsQuerySchema.safeParse({ olderThanHours: '0' }).success).toBe(false);
  });
});

describe('supervisar', () => {
  it('lo decidido mide lo que tardó en decidirse y nunca sale atrasado', () => {
    const decidido = supervisar(
      fila({ status: 'verified', submittedAt: '2026-09-20T00:00:00.000Z', decidedAt: '2026-09-25T00:00:00.000Z' }) as never,
      AHORA,
    );
    expect(decidido).toMatchObject({ ageHours: 120, stale: false, decidedAt: '2026-09-25T00:00:00.000Z' });
  });

  it('un pendiente de 47 h todavía no está atrasado', () => {
    const reciente = supervisar(fila({ submittedAt: new Date('2026-09-24T13:00:00.000Z') }) as never, AHORA);
    expect(reciente).toMatchObject({ ageHours: 47, stale: false });
  });
});

describe('OperationsPaymentClaimsController', () => {
  it('sólo roles internos de lectura, y delega con el tenant de la sesión', async () => {
    const roles = Reflect.getMetadata(ROLES_KEY, OperationsPaymentClaimsController) as string[];
    expect(roles).toEqual(['internal_operator', 'risk_analyst', 'compliance_analyst', 'admin', 'platform_admin']);
    expect(roles).not.toContain('merchant');

    const service = { list: jest.fn(async (..._args: unknown[]) => ({ items: [] })) };
    const controller = new OperationsPaymentClaimsController(service as never);
    const query = consulta();
    await controller.list('1', query);
    expect(service.list).toHaveBeenCalledWith('1', query);
  });
});
