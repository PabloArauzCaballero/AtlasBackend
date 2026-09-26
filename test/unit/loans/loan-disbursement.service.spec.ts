import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Sequelize } from 'sequelize-typescript';
import { LoanDisbursementService } from '../../../src/modules/loans/application/loan-disbursement.service.js';
import type { LoansRepository } from '../../../src/modules/loans/loans.repository.js';
import type { CreditRepository } from '../../../src/modules/credit/credit.repository.js';
import type { InternalRbacRepository } from '../../../src/modules/internal-users/internal-rbac.repository.js';
import type { ExposureReservationService } from '../../../src/modules/credit/application/exposure-reservation.service.js';
import type { OriginationConsentCheck } from '../../../src/modules/credit/application/origination-consent-check.service.js';
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
 *
 * ## Frente 3A (`_plan-motor-decisiones-tasa-2026-09-25`, §1.1, punto 5)
 *
 * La tasa YA NO se acepta libre del cuerpo (T-1). En orden: la tasa decidida por el Motor
 * (`decisionPricedRate`) manda; si no hay decisión, la del producto; si NINGUNA existe, 422
 * (`CREDIT_PRODUCT_WITHOUT_RATE`), nunca 0 % (antes del 2026-09-26 un producto sin tasa desembolsaba
 * gratis). Lo que salga de ahí se clampea SIEMPRE a `[product.min, product.max]` y al tope de
 * usura (T-4/T-5). Anular con otra tasa exige el permiso `credit.loan_disbursement.override_rate` +
 * un motivo (`overrideReasonCode`), y ese valor sigue clampeado igual — el permiso autoriza a PEDIR
 * la excepción, nunca a saltarse el tope legal.
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
    decisionPricedRate: null,
    businessAcceptance: null,
    // Revalidada al desembolsar (P-09/P-11): decidida hace un momento, sigue vigente por defecto.
    decidedAt: new Date(),
    decisionValidUntil: null,
    ...overrides,
  };
}

describe('LoanDisbursementService', () => {
  let loans: { findLoanByApplication: jest.Mock; createLoan: jest.Mock; bulkCreateInstallments: jest.Mock; createEvent: jest.Mock };
  let credit: { findApplicationById: jest.Mock; findProductById: jest.Mock };
  let rbac: { hasPermissions: jest.Mock<(...args: unknown[]) => Promise<boolean>> };
  let exposure: { reserve: jest.Mock; consume: jest.Mock };
  let consents: { assertMayOriginate: jest.Mock };
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
      findProductById: jest.fn(async () => ({
        id: 'pr-1',
        annualInterestRate: '24.0000',
        minAnnualInterestRate: null,
        maxAnnualInterestRate: null,
      })),
    };
    // Sin permiso por defecto: cada prueba que necesite anular la tasa lo concede explícitamente.
    rbac = { hasPermissions: jest.fn(async (..._args: unknown[]): Promise<boolean> => false) };
    const sequelize = { transaction: jest.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn({})) } as unknown as Sequelize;
    // P-09/P-11: revalidados al desembolsar. Estas pruebas ejercitan la tasa, no la reserva de cupo
    // ni el consentimiento, así que ambos son dobles que siempre tienen éxito.
    exposure = { reserve: jest.fn(async () => undefined), consume: jest.fn(async () => undefined) };
    consents = { assertMayOriginate: jest.fn(async () => undefined) };
    service = new LoanDisbursementService(
      loans as unknown as LoansRepository,
      credit as unknown as CreditRepository,
      sequelize,
      exposure as unknown as ExposureReservationService,
      consents as unknown as OriginationConsentCheck,
      rbac as unknown as InternalRbacRepository,
    );
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

    it('una aprobación del Motor todavía sin aceptar por el negocio NO se desembolsa', async () => {
      credit.findApplicationById.mockResolvedValueOnce(solicitud({ businessAcceptance: 'pending' }) as never);
      await expect(desembolsar()).rejects.toThrow('CREDIT_BUSINESS_ACCEPTANCE_PENDING');
      credit.findApplicationById.mockResolvedValueOnce(solicitud({ businessAcceptance: 'declined' }) as never);
      await expect(desembolsar()).rejects.toThrow('CREDIT_BUSINESS_ACCEPTANCE_DECLINED');
      expect(loans.createLoan).not.toHaveBeenCalled();
    });

    it('aceptada por el negocio, o firmada por una persona (sin aceptación aplicable), sí se desembolsa', async () => {
      credit.findApplicationById.mockResolvedValueOnce(solicitud({ businessAcceptance: 'accepted' }) as never);
      await expect(desembolsar()).resolves.toMatchObject({ loanId: 'L1' });
      credit.findApplicationById.mockResolvedValueOnce(solicitud({ businessAcceptance: null }) as never);
      await expect(desembolsar({}, 'idem-2')).resolves.toMatchObject({ loanId: 'L1' });
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

  describe('la tasa (Frente 3A): quién decide y qué la limita', () => {
    it('sin decisión del Motor, se usa la del producto', async () => {
      await desembolsar();

      expect((loans.createLoan.mock.calls.at(-1)?.[0] as { annualInterestRate: string }).annualInterestRate).toBe('24.0000');
    });

    it('la tasa decidida por el Motor (decisionPricedRate) manda sobre la del producto', async () => {
      credit.findApplicationById.mockResolvedValueOnce(solicitud({ decisionPricedRate: '18.0000' }) as never);

      await desembolsar();

      expect((loans.createLoan.mock.calls.at(-1)?.[0] as { annualInterestRate: string }).annualInterestRate).toBe('18.0000');
    });

    it('PRUEBA EN NEGATIVO — producto sin tasa y sin decisión del Motor: 422, nunca 0 % (T-1)', async () => {
      credit.findApplicationById.mockResolvedValue(solicitud({ decisionPricedRate: null }) as never);
      credit.findProductById.mockResolvedValue({
        id: 'pr-1',
        annualInterestRate: null,
        minAnnualInterestRate: null,
        maxAnnualInterestRate: null,
      } as never);

      await expect(desembolsar()).rejects.toBeInstanceOf(UnprocessableEntityException);
      await expect(desembolsar({}, 'idem-2')).rejects.toThrow('CREDIT_PRODUCT_WITHOUT_RATE');
      expect(loans.createLoan).not.toHaveBeenCalled();
    });

    it('PRUEBA EN NEGATIVO — tasa del Motor por ENCIMA del rango del producto: se clampea al techo, no se usa tal cual', async () => {
      credit.findApplicationById.mockResolvedValueOnce(solicitud({ decisionPricedRate: '30.0000' }) as never);
      credit.findProductById.mockResolvedValueOnce({
        id: 'pr-1',
        annualInterestRate: '20.0000',
        minAnnualInterestRate: '15.0000',
        maxAnnualInterestRate: '22.0000',
      } as never);

      await desembolsar();

      expect((loans.createLoan.mock.calls.at(-1)?.[0] as { annualInterestRate: string }).annualInterestRate).toBe('22.0000');
    });

    it('PRUEBA EN NEGATIVO — tasa del Motor por DEBAJO del rango del producto: se clampea al suelo', async () => {
      credit.findApplicationById.mockResolvedValueOnce(solicitud({ decisionPricedRate: '5.0000' }) as never);
      credit.findProductById.mockResolvedValueOnce({
        id: 'pr-1',
        annualInterestRate: '20.0000',
        minAnnualInterestRate: '15.0000',
        maxAnnualInterestRate: '22.0000',
      } as never);

      await desembolsar();

      expect((loans.createLoan.mock.calls.at(-1)?.[0] as { annualInterestRate: string }).annualInterestRate).toBe('15.0000');
    });

    it('PRUEBA EN NEGATIVO — tasa del Motor SOBRE el tope de usura: se clampea a la usura, aunque el rango del producto la permitiera', async () => {
      credit.findApplicationById.mockResolvedValueOnce(solicitud({ decisionPricedRate: '32.0000' }) as never);
      credit.findProductById.mockResolvedValueOnce({
        id: 'pr-1',
        annualInterestRate: '20.0000',
        minAnnualInterestRate: null,
        maxAnnualInterestRate: '40.0000',
      } as never);

      await desembolsar();

      // USURY_CAP_RATE por defecto es 0.24 → 24 %.
      expect((loans.createLoan.mock.calls.at(-1)?.[0] as { annualInterestRate: string }).annualInterestRate).toBe('24.0000');
    });

    it('un producto sin rango declarado (min/max NULL) no bloquea: sólo deja de estrechar, la usura sigue mandando', async () => {
      credit.findApplicationById.mockResolvedValueOnce(solicitud({ decisionPricedRate: '18.0000' }) as never);
      credit.findProductById.mockResolvedValueOnce({
        id: 'pr-1',
        annualInterestRate: '18.0000',
        minAnnualInterestRate: null,
        maxAnnualInterestRate: null,
      } as never);

      await desembolsar();

      expect((loans.createLoan.mock.calls.at(-1)?.[0] as { annualInterestRate: string }).annualInterestRate).toBe('18.0000');
    });

    it('una tasa negativa o ilegible en el override se rechaza antes de escribir nada', async () => {
      rbac.hasPermissions.mockResolvedValue(true);
      await expect(desembolsar({ overrideAnnualInterestRate: -1, overrideReasonCode: 'campaña' })).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(loans.createLoan).not.toHaveBeenCalled();
    });

    describe('anular la tasa decidida: permiso + motivo, y el valor sigue clampeado', () => {
      it('PRUEBA EN NEGATIVO — un operador SIN el permiso nuevo que intenta forzar una tasa: 403, no se desembolsa', async () => {
        rbac.hasPermissions.mockResolvedValue(false);

        await expect(desembolsar({ overrideAnnualInterestRate: 10, overrideReasonCode: 'campaña de fin de año' })).rejects.toBeInstanceOf(
          ForbiddenException,
        );
        expect(loans.createLoan).not.toHaveBeenCalled();
        expect(rbac.hasPermissions).toHaveBeenCalledWith('t1', '7', ['credit.loan_disbursement.override_rate']);
      });

      it('una sesión sin internalUserId (p. ej. un token de cliente) tampoco puede anular la tasa, ni consulta el permiso', async () => {
        const sinSesionInterna = { role: 'customer', internalUserId: undefined, tenantId: 't1' } as unknown as AuthenticatedUser;

        await expect(
          service.disburse({
            tenantId: 't1',
            applicationId: 'ap-1',
            body: { overrideAnnualInterestRate: 10, overrideReasonCode: 'motivo' } as never,
            currentUser: sinSesionInterna,
            idempotencyKey: 'idem-x',
          }),
        ).rejects.toBeInstanceOf(ForbiddenException);
        expect(rbac.hasPermissions).not.toHaveBeenCalled();
      });

      it('CON el permiso, la tasa pedida se usa — pero SIGUE clampeada al rango y a la usura', async () => {
        rbac.hasPermissions.mockResolvedValue(true);
        credit.findProductById.mockResolvedValueOnce({
          id: 'pr-1',
          annualInterestRate: '20.0000',
          minAnnualInterestRate: '10.0000',
          maxAnnualInterestRate: '22.0000',
        } as never);

        // Dentro de rango: se respeta.
        await desembolsar({ overrideAnnualInterestRate: 15, overrideReasonCode: 'renegociación' });
        expect((loans.createLoan.mock.calls.at(-1)?.[0] as { annualInterestRate: string }).annualInterestRate).toBe('15.0000');

        // Por encima del techo del producto: se clampea, el permiso no lo salta.
        credit.findProductById.mockResolvedValueOnce({
          id: 'pr-1',
          annualInterestRate: '20.0000',
          minAnnualInterestRate: '10.0000',
          maxAnnualInterestRate: '22.0000',
        } as never);
        await desembolsar({ overrideAnnualInterestRate: 90, overrideReasonCode: 'renegociación' }, 'idem-2');
        expect((loans.createLoan.mock.calls.at(-1)?.[0] as { annualInterestRate: string }).annualInterestRate).toBe('22.0000');
      });

      it('PRUEBA EN NEGATIVO — CON el permiso, un override sobre la usura sigue clampeado a la usura', async () => {
        rbac.hasPermissions.mockResolvedValue(true);
        credit.findProductById.mockResolvedValueOnce({
          id: 'pr-1',
          annualInterestRate: '20.0000',
          minAnnualInterestRate: null,
          maxAnnualInterestRate: '90.0000',
        } as never);

        await desembolsar({ overrideAnnualInterestRate: 60, overrideReasonCode: 'excepción de dirección' });

        expect((loans.createLoan.mock.calls.at(-1)?.[0] as { annualInterestRate: string }).annualInterestRate).toBe('24.0000');
      });

      it('el motivo de la anulación queda en el evento del préstamo, como evidencia de que se pidió', async () => {
        rbac.hasPermissions.mockResolvedValue(true);

        await desembolsar({ overrideAnnualInterestRate: 18, overrideReasonCode: 'campaña de fin de año' });

        const [evento] = loans.createEvent.mock.calls.at(-1) as [Record<string, unknown>];
        expect(evento.payloadJson).toMatchObject({ rateOverrideReasonCode: 'campaña de fin de año' });
      });

      it('sin anulación, el evento no inventa un motivo', async () => {
        await desembolsar();

        const [evento] = loans.createEvent.mock.calls.at(-1) as [Record<string, unknown>];
        expect(evento.payloadJson).toMatchObject({ rateOverrideReasonCode: null });
      });
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

  /*
   * El ALTA del crédito en el motor no se prueba aquí porque no ocurre aquí: el libro de préstamos
   * no puede depender del módulo del motor (`config/architecture/boundaries.json`: `loans` sólo se
   * apoya en `credit` e `internal-users`), así que la hace `OutcomeDispatchService.registrarCreditosNuevos`
   * y sus pruebas viven allí.
   *
   * Lo que este servicio TIENE que garantizar es el rastro sin el cual esa alta es imposible: el
   * motor toma el sujeto de la decisión de origen, y la referencia del solicitante viaja en HMAC de
   * una vía, así que no se puede añadir después. Sin estas tres columnas, el crédito no se podría
   * atribuir a nadie nunca.
   */
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
      credit.findApplicationById.mockResolvedValueOnce(solicitud({ decisionPricedRate: '18.0000' }) as never);

      await desembolsar();

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
