import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { Sequelize } from 'sequelize-typescript';
import { LoanDisbursementService } from '../../../src/modules/loans/application/loan-disbursement.service.js';
import type { LoansRepository } from '../../../src/modules/loans/loans.repository.js';
import type { CreditRepository } from '../../../src/modules/credit/credit.repository.js';
import type { AuthenticatedUser } from '../../../src/common/types/auth.types.js';

/**
 * El desembolso: el momento en que la decisión se convierte en dinero y en obligación.
 *
 * Todo ocurre en UNA transacción —préstamo, cronograma y evento— porque un préstamo sin cuotas no
 * es un estado intermedio aceptable: nadie sabría qué cobrarle ni cuándo, y la mora se calcularía
 * sobre un cronograma vacío, es decir, cero para siempre.
 *
 * El estado inicial del libro se ESCRIBE y no se deja al azar. Estas columnas tienen DEFAULT en
 * PostgreSQL, pero el modelo las declara obligatorias sin `defaultValue`, así que Sequelize validaba
 * antes de llegar a la base y la creación fallaba con un 409 genérico que no decía qué columna. El
 * desembolso no había funcionado nunca: `credit.loans` estaba vacía. Es el caso que estas pruebas
 * fijan de forma más literal.
 *
 * Sólo una solicitud APROBADA origina un préstamo, y el reintento con la misma clave devuelve el
 * que ya existe en vez de crear otro; con una clave distinta es conflicto, porque eso ya no es un
 * reintento sino un segundo desembolso del mismo crédito.
 *
 * Y el préstamo hereda la referencia a la ejecución del motor que lo decidió: sin esa arista, el
 * monitoreo no tiene a quién atribuir el desenlace real meses después.
 */
const OPERADOR = { role: 'internal_operator', internalUserId: '7', tenantId: 't1' } as AuthenticatedUser;

function solicitud(overrides: Record<string, unknown> = {}) {
  return {
    id: 'ap-1',
    status: 'approved',
    customerId: 'c1',
    creditProductId: 'pr-1',
    partnerProfileId: 'pp-1',
    currencyCode: 'BOB',
    requestedAmount: '1200.00',
    requestedTermMonths: 6,
    decisionExecutionId: 'exe-1',
    decisionArtifactVersionId: 'art-2',
    decisionSubjectReference: 'cust:c1',
    ...overrides,
  };
}

describe('LoanDisbursementService', () => {
  let loans: { findLoanByApplication: jest.Mock; createLoan: jest.Mock; bulkCreateInstallments: jest.Mock; createEvent: jest.Mock };
  let credit: { findApplicationById: jest.Mock; findProductById: jest.Mock };
  let service: LoanDisbursementService;

  beforeEach(() => {
    loans = {
      findLoanByApplication: jest.fn(async () => null),
      createLoan: jest.fn(async (values: unknown) => ({ id: 'L1', maturityDate: null, ...(values as Record<string, unknown>) })),
      bulkCreateInstallments: jest.fn(async () => undefined),
      createEvent: jest.fn(async () => ({ id: 1 })),
    };
    credit = {
      findApplicationById: jest.fn(async () => solicitud()),
      findProductById: jest.fn(async () => ({ id: 'pr-1', annualInterestRate: '24.0000' })),
    };
    const sequelize = { transaction: jest.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn({})) } as unknown as Sequelize;
    service = new LoanDisbursementService(loans as unknown as LoansRepository, credit as unknown as CreditRepository, sequelize);
  });

  function desembolsar(body: Record<string, unknown> = {}, clave = 'idem-1') {
    return service.disburse({ tenantId: 't1', applicationId: 'ap-1', body: body as never, currentUser: OPERADOR, idempotencyKey: clave });
  }

  describe('quién puede desembolsarse', () => {
    it('una solicitud que no existe es 404', async () => {
      credit.findApplicationById.mockResolvedValueOnce(null as never);

      await expect(desembolsar()).rejects.toBeInstanceOf(NotFoundException);
      expect(loans.createLoan).not.toHaveBeenCalled();
    });

    it('sólo una APROBADA origina un préstamo: ni una en revisión ni una rechazada', async () => {
      for (const estado of ['pending_review', 'rejected', 'disbursed']) {
        credit.findApplicationById.mockResolvedValueOnce(solicitud({ status: estado }) as never);

        await expect(desembolsar()).rejects.toBeInstanceOf(ConflictException);
      }
      expect(loans.createLoan).not.toHaveBeenCalled();
    });

    it('un producto que ya no existe es 404 y no un préstamo sin tasa', async () => {
      credit.findProductById.mockResolvedValueOnce(null as never);

      await expect(desembolsar()).rejects.toBeInstanceOf(NotFoundException);
      expect(loans.createLoan).not.toHaveBeenCalled();
    });
  });

  describe('idempotencia', () => {
    it('el reintento con la MISMA clave devuelve el préstamo que ya existe', async () => {
      const yaCreado = await desembolsar({}, 'idem-1');
      const hash = (loans.createLoan.mock.calls[0]?.[0] as { idempotencyKeyHash: string }).idempotencyKeyHash;
      loans.createLoan.mockClear();
      loans.findLoanByApplication.mockResolvedValueOnce({
        id: 'L1',
        loanCode: yaCreado.loanCode,
        status: 'active',
        maturityDate: yaCreado.maturityDate,
        idempotencyKeyHash: hash,
      } as never);

      const reintento = await desembolsar({}, 'idem-1');

      expect(reintento.loanId).toBe('L1');
      expect(loans.createLoan).not.toHaveBeenCalled();
    });

    it('con OTRA clave es conflicto: eso ya no es un reintento sino un segundo desembolso', async () => {
      loans.findLoanByApplication.mockResolvedValueOnce({ id: 'L1', idempotencyKeyHash: 'otro-hash' } as never);

      await expect(desembolsar({}, 'idem-2')).rejects.toBeInstanceOf(ConflictException);
      expect(loans.createLoan).not.toHaveBeenCalled();
    });

    it('la clave se guarda HASHEADA y no en claro', async () => {
      await desembolsar({}, 'clave-del-cliente');

      const [values] = loans.createLoan.mock.calls.at(-1) as [Record<string, unknown>];
      expect(values.idempotencyKeyHash).toEqual(expect.any(String));
      expect(values.idempotencyKeyHash).not.toBe('clave-del-cliente');
    });
  });

  describe('el estado inicial del libro', () => {
    it('las columnas de dinero y mora se ESCRIBEN: dejarlas al DEFAULT hacía fallar el desembolso entero', async () => {
      await desembolsar();

      const [values] = loans.createLoan.mock.calls.at(-1) as [Record<string, unknown>];
      expect(values).toMatchObject({
        paidPrincipal: '0.00',
        paidInterest: '0.00',
        paidLateFee: '0.00',
        daysPastDue: 0,
        worstDaysPastDue: 0,
        delinquencyBucket: 'current',
        status: 'active',
        deleted: false,
      });
      expect(values.createdAtValue).toBeInstanceOf(Date);
    });

    it('el saldo vivo nace igual al capital: un préstamo recién nacido no tiene nada pagado', async () => {
      await desembolsar();

      const [values] = loans.createLoan.mock.calls.at(-1) as [Record<string, string>];
      expect(values.principalAmount).toBe('1200.00');
      expect(values.outstandingPrincipal).toBe('1200.00');
      expect(values.scheduledPrincipal).toBe('1200.00');
    });

    it('cada cuota también nace con sus columnas escritas, no al azar', async () => {
      await desembolsar();

      const [filas] = loans.bulkCreateInstallments.mock.calls.at(-1) as [Array<Record<string, unknown>>];
      expect(filas).toHaveLength(6);
      for (const fila of filas) {
        expect(fila).toMatchObject({ status: 'pending', lateFeeAmount: '0.00', paidPrincipal: '0.00', daysPastDue: 0, deleted: false });
        expect(fila.createdAtValue).toBeInstanceOf(Date);
      }
    });
  });

  describe('los términos', () => {
    it('la tasa del cuerpo manda sobre la del producto', async () => {
      await desembolsar({ annualInterestRate: 18 });

      expect((loans.createLoan.mock.calls.at(-1)?.[0] as { annualInterestRate: string }).annualInterestRate).toBe('18.0000');
    });

    it('sin tasa en el cuerpo se usa la del producto', async () => {
      await desembolsar();

      expect((loans.createLoan.mock.calls.at(-1)?.[0] as { annualInterestRate: string }).annualInterestRate).toBe('24.0000');
    });

    it('un producto sin tasa desembolsa al 0 %, no con NaN', async () => {
      credit.findProductById.mockResolvedValueOnce({ id: 'pr-1', annualInterestRate: null } as never);

      await desembolsar();

      expect((loans.createLoan.mock.calls.at(-1)?.[0] as { annualInterestRate: string }).annualInterestRate).toBe('0.0000');
    });

    it('una tasa negativa o ilegible se rechaza antes de escribir nada', async () => {
      await expect(desembolsar({ annualInterestRate: -1 })).rejects.toBeInstanceOf(BadRequestException);
      await expect(desembolsar({ annualInterestRate: 'x' })).rejects.toBeInstanceOf(BadRequestException);
      expect(loans.createLoan).not.toHaveBeenCalled();
    });

    it('sin primera fecha, el primer vencimiento cae un mes después del desembolso', async () => {
      await desembolsar({ disbursedAt: '2026-01-31T10:00:00.000Z' });

      const [filas] = loans.bulkCreateInstallments.mock.calls.at(-1) as [Array<{ dueDate: string }>];
      expect(filas[0].dueDate).toBe('2026-02-28');
    });

    it('con primera fecha explícita se respeta', async () => {
      await desembolsar({ firstDueDate: '2026-03-15' });

      const [filas] = loans.bulkCreateInstallments.mock.calls.at(-1) as [Array<{ dueDate: string }>];
      expect(filas[0].dueDate).toBe('2026-03-15');
    });

    it('la fecha de vencimiento del préstamo es la de la ÚLTIMA cuota', async () => {
      const dto = await desembolsar({ firstDueDate: '2026-03-15' });
      const [filas] = loans.bulkCreateInstallments.mock.calls.at(-1) as [Array<{ dueDate: string }>];

      expect(dto.maturityDate).toBe(filas[filas.length - 1].dueDate);
    });
  });

  describe('la traza al motor', () => {
    it('el préstamo hereda qué ejecución y qué versión del artefacto lo decidieron', async () => {
      await desembolsar();

      expect(loans.createLoan).toHaveBeenCalledWith(
        expect.objectContaining({
          decisionExecutionId: 'exe-1',
          decisionArtifactVersionId: 'art-2',
          decisionSubjectReference: 'cust:c1',
        }),
        expect.anything(),
      );
    });

    it('una solicitud sin traza no inventa una: viaja nula', async () => {
      credit.findApplicationById.mockResolvedValueOnce(
        solicitud({ decisionExecutionId: null, decisionArtifactVersionId: null, decisionSubjectReference: null }) as never,
      );

      await desembolsar();

      expect(loans.createLoan).toHaveBeenCalledWith(
        expect.objectContaining({ decisionExecutionId: null, decisionArtifactVersionId: null }),
        expect.anything(),
      );
    });

    it('el comercio se COPIA desde la solicitud: el libro se lee entero por sí mismo', async () => {
      await desembolsar();

      expect((loans.createLoan.mock.calls.at(-1)?.[0] as { partnerProfileId: string }).partnerProfileId).toBe('pp-1');
    });

    it('el evento del desembolso deja quién lo hizo y con qué condiciones', async () => {
      await desembolsar({ annualInterestRate: 18 });

      const [evento] = loans.createEvent.mock.calls.at(-1) as [Record<string, unknown>];
      expect(evento).toMatchObject({ eventType: 'loan_disbursed', previousStatus: null, newStatus: 'active', actorInternalUserId: '7' });
      expect(evento.payloadJson).toMatchObject({
        principal: '1200.00',
        termMonths: 6,
        annualInterestRate: 18,
        decisionExecutionId: 'exe-1',
      });
    });
  });
});
