import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { NotFoundException } from '@nestjs/common';
import { LoanQueryService } from '../../../src/modules/loans/application/loan-query.service.js';
import type { LoansRepository } from '../../../src/modules/loans/loans.repository.js';
import type { PartnerDirectoryService } from '../../../src/modules/partner-onboarding/application/partner-directory.service.js';
import type { LoanModel } from '../../../src/database/models/index.js';

/**
 * Las lecturas del préstamo.
 *
 * Tres decisiones, y ninguna se ve fallar.
 *
 * Un crédito sin comercio conocido devuelve `null` y NO un comercio inventado. Los créditos
 * anteriores al vínculo no saben dónde se compraron, y rellenarlos con «Otros» los mezclaría con
 * los que de verdad no tienen rubro. La pantalla decide cómo mostrar la ausencia; el servidor no la
 * disfraza.
 *
 * Los comercios se resuelven de UNA vez y no por préstamo: la pantalla de pagos los agrupa por
 * comercio, así que preguntarlos uno a uno haría tantas consultas como compras tenga el cliente.
 *
 * Y la ficha lleva el identificador de CUOTA. Sin él la app podía enseñar el calendario pero no
 * pagar ninguna cuota: avisar de un pago exige decir de QUÉ cuota se habla, y el número de orden no
 * sirve porque se repite entre créditos. La pantalla de pago quedaba sin forma de nombrar lo que el
 * cliente acababa de transferir.
 */
function prestamo(overrides: Record<string, unknown> = {}): LoanModel {
  return {
    id: 'L1',
    loanCode: 'CR-1',
    customerId: 'c1',
    creditApplicationId: 'ap-1',
    currencyCode: 'BOB',
    principalAmount: '1000.00',
    annualInterestRate: '0.24',
    termMonths: 6,
    status: 'active',
    partnerProfileId: 'pp-1',
    decisionExecutionId: 'exe-1',
    decisionArtifactVersionId: 'art-2',
    ...overrides,
  } as unknown as LoanModel;
}

describe('LoanQueryService', () => {
  let loans: {
    findLoansByCustomer: jest.Mock;
    findLoanById: jest.Mock;
    findInstallments: jest.Mock;
    findPaymentsByLoan: jest.Mock;
    findEventsByLoan: jest.Mock;
  };
  let partnerDirectory: { describeMany: jest.Mock };
  let service: LoanQueryService;
  let comercios: Map<string, { displayName: string; businessCategory: string | null }>;

  beforeEach(() => {
    comercios = new Map([['pp-1', { displayName: 'Ferretería Sur', businessCategory: 'hardware' }]]);
    loans = {
      findLoansByCustomer: jest.fn(async () => []),
      findLoanById: jest.fn(async () => prestamo()),
      findInstallments: jest.fn(async () => []),
      findPaymentsByLoan: jest.fn(async () => []),
      findEventsByLoan: jest.fn(async () => []),
    };
    partnerDirectory = { describeMany: jest.fn(async () => comercios) };
    service = new LoanQueryService(loans as unknown as LoansRepository, partnerDirectory as unknown as PartnerDirectoryService);
  });

  describe('los créditos del cliente', () => {
    it('los comercios se piden de UNA vez, no uno por préstamo', async () => {
      loans.findLoansByCustomer.mockResolvedValueOnce([
        prestamo({ id: 'L1', partnerProfileId: 'pp-1' }),
        prestamo({ id: 'L2', partnerProfileId: 'pp-2' }),
        prestamo({ id: 'L3', partnerProfileId: 'pp-1' }),
      ] as never);

      await service.listByCustomer('t1', 'c1');

      expect(partnerDirectory.describeMany).toHaveBeenCalledTimes(1);
      expect(partnerDirectory.describeMany).toHaveBeenCalledWith('t1', ['pp-1', 'pp-2', 'pp-1']);
    });

    it('un crédito sin comercio no se cuenta al pedir el directorio', async () => {
      loans.findLoansByCustomer.mockResolvedValueOnce([prestamo({ partnerProfileId: null })] as never);

      await service.listByCustomer('t1', 'c1');

      expect(partnerDirectory.describeMany).toHaveBeenCalledWith('t1', []);
    });

    it('cada crédito sale con su comercio resuelto', async () => {
      loans.findLoansByCustomer.mockResolvedValueOnce([prestamo()] as never);

      const { items } = await service.listByCustomer('t1', 'c1');

      expect(items[0].merchant).toEqual({ partnerProfileId: 'pp-1', displayName: 'Ferretería Sur', businessCategory: 'hardware' });
    });

    it('un crédito sin comercio devuelve NULL: el servidor no disfraza la ausencia', async () => {
      loans.findLoansByCustomer.mockResolvedValueOnce([prestamo({ partnerProfileId: null })] as never);

      const { items } = await service.listByCustomer('t1', 'c1');

      expect(items[0].merchant).toBeNull();
    });

    it('un comercio que el directorio no resuelve también es null, no un identificador suelto', async () => {
      loans.findLoansByCustomer.mockResolvedValueOnce([prestamo({ partnerProfileId: 'pp-desconocido' })] as never);

      const { items } = await service.listByCustomer('t1', 'c1');

      expect(items[0].merchant).toBeNull();
    });

    it('sin créditos devuelve la lista vacía y no falla', async () => {
      await expect(service.listByCustomer('t1', 'c1')).resolves.toEqual({ items: [] });
    });
  });

  describe('la ficha del préstamo', () => {
    it('un préstamo que no existe es 404 y no se piden sus cuotas', async () => {
      loans.findLoanById.mockResolvedValueOnce(null as never);

      await expect(service.detail('t1', 'L9')).rejects.toBeInstanceOf(NotFoundException);
      expect(loans.findInstallments).not.toHaveBeenCalled();
    });

    it('la cabecera lleva la referencia a la DECISIÓN que originó el préstamo', async () => {
      const ficha = await service.detail('t1', 'L1');

      expect(ficha.decision).toEqual({ executionId: 'exe-1', artifactVersionId: 'art-2' });
    });

    it('cada cuota lleva su IDENTIFICADOR: sin él la app no puede nombrar lo que se acaba de pagar', async () => {
      loans.findInstallments.mockResolvedValueOnce([
        {
          id: 77,
          installmentNumber: 1,
          dueDate: '2026-09-20',
          principalAmount: '100',
          interestAmount: '10',
          lateFeeAmount: '0',
          paidPrincipal: '0',
          paidInterest: '0',
          paidLateFee: '0',
          status: 'pending',
          daysPastDue: 0,
          settledAt: null,
        },
      ] as never);

      const ficha = await service.detail('t1', 'L1');

      expect(ficha.schedule[0].installmentId).toBe('77');
      expect(ficha.schedule[0].installmentNumber).toBe(1);
    });

    it('el cronograma, los cobros y el historial se piden en paralelo y salen juntos', async () => {
      loans.findPaymentsByLoan.mockResolvedValueOnce([
        {
          id: 3,
          paymentCode: 'PG-3',
          amount: '110.00',
          currencyCode: 'BOB',
          paymentMethod: 'QR',
          externalReference: 'ref-1',
          receivedAt: new Date('2026-09-05T10:00:00Z'),
          status: 'confirmed',
          reversedAt: null,
          reversalReasonCode: null,
        },
      ] as never);
      loans.findEventsByLoan.mockResolvedValueOnce([
        {
          eventType: 'DISBURSED',
          previousStatus: null,
          newStatus: 'active',
          reasonCode: null,
          happenedAt: new Date('2026-09-01T10:00:00Z'),
          notes: null,
        },
      ] as never);

      const ficha = await service.detail('t1', 'L1');

      expect(ficha.payments[0]).toMatchObject({ paymentId: 3, paymentCode: 'PG-3', status: 'confirmed' });
      expect(ficha.history[0]).toMatchObject({ eventType: 'DISBURSED', newStatus: 'active' });
      expect(loans.findInstallments).toHaveBeenCalledWith('t1', 'L1');
      expect(loans.findPaymentsByLoan).toHaveBeenCalledWith('t1', 'L1');
      expect(loans.findEventsByLoan).toHaveBeenCalledWith('t1', 'L1');
    });

    it('un cobro reversado conserva su motivo y su fecha de reverso', async () => {
      loans.findPaymentsByLoan.mockResolvedValueOnce([
        {
          id: 3,
          paymentCode: 'PG-3',
          amount: '110.00',
          currencyCode: 'BOB',
          paymentMethod: 'QR',
          externalReference: null,
          receivedAt: new Date('2026-09-05T10:00:00Z'),
          status: 'reversed',
          reversedAt: new Date('2026-09-06T10:00:00Z'),
          reversalReasonCode: 'DUPLICADO',
        },
      ] as never);

      const ficha = await service.detail('t1', 'L1');

      expect(ficha.payments[0]).toMatchObject({ status: 'reversed', reversalReasonCode: 'DUPLICADO' });
      expect(ficha.payments[0].reversedAt).toEqual(new Date('2026-09-06T10:00:00Z'));
    });

    it('la ficha usa el mismo resumen que el listado: dos vistas del mismo préstamo no pueden discrepar', async () => {
      loans.findLoansByCustomer.mockResolvedValueOnce([prestamo()] as never);
      const { items } = await service.listByCustomer('t1', 'c1');
      const ficha = await service.detail('t1', 'L1');

      const { merchant: _m1, ...delListado } = items[0];
      const { merchant: _m2, schedule: _s, payments: _p, history: _h, ...deLaFicha } = ficha;
      expect(deLaFicha).toEqual(delListado);
    });

    it('la ficha también resuelve el comercio del préstamo', async () => {
      const ficha = await service.detail('t1', 'L1');

      expect(partnerDirectory.describeMany).toHaveBeenCalledWith('t1', ['pp-1']);
      expect(ficha.merchant).toMatchObject({ displayName: 'Ferretería Sur' });
    });
  });
});
