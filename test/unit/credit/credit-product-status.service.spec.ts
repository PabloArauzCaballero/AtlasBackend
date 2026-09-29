import { describe, expect, it, jest } from '@jest/globals';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { CreditProductStatusService } from '../../../src/modules/credit/application/credit-product-status.service.js';
import {
  canTransitionCreditProduct,
  CREDIT_PRODUCT_STATUSES,
  CREDIT_PRODUCT_TRANSITIONS,
} from '../../../src/modules/credit/domain/credit-product-status.js';

/**
 * Adenda §4.2 (2026-09-29): el portal decía «cambio de estado auditado» y el servidor hacía
 * `status = x; save()` sin motivo, sin actor, sin validar la transición (de `retired` a `active`
 * pasaba) y sin rastro. Estas pruebas fijan la tabla de transiciones y que estado y auditoría van
 * en la misma transacción.
 */
const operador = { sub: 'op-3', tenantId: '7', internalUserId: '3', role: 'admin' } as never;

function build(status: string | null = 'active') {
  const transaction = { id: 'tx-1', LOCK: { UPDATE: 'UPDATE' } };
  const product = status === null ? null : { id: '21', productCode: 'BNPL-3', status };
  const creditRepository = {
    findProductById: jest.fn(async (..._args: unknown[]) => product),
    updateProductStatus: jest.fn(async (..._args: unknown[]) => undefined),
  };
  const audit = { recordStatusChange: jest.fn(async (..._args: unknown[]) => undefined) };
  const sequelize = { transaction: jest.fn(async (callback: (value: unknown) => Promise<unknown>) => callback(transaction)) };
  const service = new CreditProductStatusService(creditRepository as never, audit as never, sequelize as never);
  return { service, creditRepository, audit, transaction, product };
}

describe('tabla de transiciones de un producto crediticio', () => {
  it.each([
    ['draft', 'active', true],
    ['draft', 'retired', true],
    ['draft', 'suspended', false],
    ['active', 'suspended', true],
    ['active', 'retired', true],
    ['active', 'draft', false],
    ['active', 'active', false],
    ['suspended', 'active', true],
    ['suspended', 'retired', true],
    ['retired', 'active', false],
    ['retired', 'draft', false],
    ['retired', 'suspended', false],
    ['desconocido', 'active', false],
  ] as const)('%s → %s: %s', (from, to, esperado) => {
    expect(canTransitionCreditProduct(from, to)).toBe(esperado);
  });

  it('retirado es terminal y cada estado tiene su fila', () => {
    expect(CREDIT_PRODUCT_TRANSITIONS.retired).toEqual([]);
    expect(Object.keys(CREDIT_PRODUCT_TRANSITIONS).sort()).toEqual([...CREDIT_PRODUCT_STATUSES].sort());
  });
});

describe('CreditProductStatusService', () => {
  it('cambia el estado y deja la huella (actor, de qué a qué y motivo) en la MISMA transacción', async () => {
    const { service, creditRepository, audit, transaction, product } = build('active');
    const result = await service.changeStatus({
      tenantId: '7',
      productId: '21',
      status: 'suspended',
      reasonCode: 'revision_usura',
      currentUser: operador,
    });

    expect(result).toMatchObject({ productId: '21', previousStatus: 'active', status: 'suspended', reasonCode: 'revision_usura' });
    expect(creditRepository.findProductById).toHaveBeenCalledWith('7', '21', { transaction, lock: true });
    expect(creditRepository.updateProductStatus).toHaveBeenCalledWith(product, 'suspended', expect.any(Date), { transaction });
    expect(audit.recordStatusChange).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: '7',
        productId: '21',
        productCode: 'BNPL-3',
        previousStatus: 'active',
        newStatus: 'suspended',
        reasonCode: 'revision_usura',
        actorType: 'admin',
        actorInternalUserId: '3',
      }),
      { transaction },
    );
  });

  it('rechaza con 409 una transición no permitida y no escribe NI el estado NI la auditoría', async () => {
    const { service, creditRepository, audit } = build('retired');
    await expect(
      service.changeStatus({ tenantId: '7', productId: '21', status: 'active', reasonCode: 'reabrir', currentUser: operador }),
    ).rejects.toThrow(ConflictException);
    expect(creditRepository.updateProductStatus).not.toHaveBeenCalled();
    expect(audit.recordStatusChange).not.toHaveBeenCalled();
  });

  it('producto inexistente: 404', async () => {
    const { service } = build(null);
    await expect(
      service.changeStatus({ tenantId: '7', productId: '404', status: 'retired', reasonCode: 'x', currentUser: operador }),
    ).rejects.toThrow(NotFoundException);
  });
});
