import { afterAll, beforeAll, describe, expect, it, jest } from '@jest/globals';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { LoanDisbursementService } from '../../../src/modules/loans/application/loan-disbursement.service.js';
import { LoanPaymentService } from '../../../src/modules/loans/application/loan-payment.service.js';
import { LoanQueryService } from '../../../src/modules/loans/application/loan-query.service.js';
import { LoanSpendingService } from '../../../src/modules/loans/application/loan-spending.service.js';
import { LoanCalendarService } from '../../../src/modules/loans/application/loan-calendar.service.js';
import { DelinquencyPolicyService } from '../../../src/modules/loans/application/delinquency-policy.service.js';
import { SpendingReportService } from '../../../src/modules/loans/application/spending-report.service.js';
import { LoanWriteOffService } from '../../../src/modules/loans/application/loan-writeoff.service.js';
import { LoansController } from '../../../src/modules/loans/loans.controller.js';
import { authHeader, buildLoansTestApp } from './support/loans-test-app.js';

/**
 * Contrato HTTP del libro de préstamos.
 *
 * Lo que se fija aquí no es la aritmética —de eso se ocupan las pruebas del dominio— sino quién
 * puede mover dinero y qué se valida antes de moverlo. Un error en esta capa no da un número mal:
 * da un desembolso hecho por quien no debía, o un cobro aceptado sin clave de idempotencia que la
 * pasarela repetirá.
 */
describe('LoansController (e2e/supertest)', () => {
  let app: INestApplication;

  const disbursement = {
    disburse: jest.fn(async (..._args: unknown[]) => ({
      loanId: '10',
      loanCode: 'LOAN-1',
      status: 'active',
      maturityDate: '2027-08-15',
    })),
  };
  const payments = {
    registerPayment: jest.fn(async (..._args: unknown[]) => ({ paymentId: '5', paymentCode: 'PAY-1', duplicated: false })),
    reversePayment: jest.fn(async (..._args: unknown[]) => ({ paymentId: '5', status: 'reversed' })),
  };
  const writeOff = { writeOff: jest.fn(async (..._args: unknown[]) => ({ loanId: '10', status: 'written_off' })) };
  /*
    El préstamo del doble tiene DUEÑO, y es quien firma el token de cliente.

    La ficha comprueba la propiedad contra `loan.customerId` —se le añadió cuando se descubrió que
    con el rol `customer` bastaba cambiar el número de la URL para leer el crédito de cualquier
    otro—. Un doble que devuelve un préstamo sin dueño hace que esa comprobación compare contra
    `undefined` y responda 403: no es que el permiso esté mal, es que el préstamo de mentira no era
    de nadie.
  */
  const CLIENTE = '77';
  const queries = {
    listByCustomer: jest.fn(async (..._args: unknown[]) => ({ items: [] })),
    detail: jest.fn(async (..._args: unknown[]) => ({ loanId: '10', customerId: CLIENTE })),
  };

  /*
    Los cuatro servicios de solo lectura que el controlador incorporo despues.

    Esta suite fija el contrato HTTP —quien puede mover dinero y que se valida antes— y no toca sus
    rutas, pero Nest resuelve el controlador ENTERO al construir el modulo: sin ellos no arranca, y
    entonces no falla una prueba sino las diecisiete, antes de ejecutar un solo caso. Se declaran
    con los metodos que el controlador llama de verdad, no como objetos vacios: un doble sin metodo
    convierte un fallo de contrato en un `undefined is not a function` que no dice nada.
  */
  const spending = { byCategory: jest.fn(async (..._args: unknown[]) => ({ categories: [] })) };
  const calendar = { forCustomer: jest.fn(async (..._args: unknown[]) => ({ months: [], entries: [] })) };
  const policies = { current: jest.fn(async (..._args: unknown[]) => ({ policies: [] })) };
  const report = { pdf: jest.fn(async (..._args: unknown[]) => Buffer.from('%PDF-1.4')) };

  const TENANT: [string, string] = ['x-tenant-id', '1'];
  const IDEMPOTENCY: [string, string] = ['x-idempotency-key', 'idem-e2e-1'];

  beforeAll(async () => {
    app = await buildLoansTestApp(
      [LoansController],
      [
        { provide: LoanDisbursementService, useValue: disbursement },
        { provide: LoanPaymentService, useValue: payments },
        { provide: LoanWriteOffService, useValue: writeOff },
        { provide: LoanQueryService, useValue: queries },
        { provide: LoanSpendingService, useValue: spending },
        { provide: LoanCalendarService, useValue: calendar },
        { provide: DelinquencyPolicyService, useValue: policies },
        { provide: SpendingReportService, useValue: report },
      ],
    );
  });

  afterAll(async () => {
    await app.close();
  });

  describe('seguridad', () => {
    it('rechaza con 401 sin token', async () => {
      await request(app.getHttpServer())
        .post('/credit-applications/1/disbursement')
        .set(...TENANT)
        .set(...IDEMPOTENCY)
        .send({})
        .expect(401);
      expect(disbursement.disburse).not.toHaveBeenCalled();
    });

    it('un cliente NO puede desembolsar su propio préstamo', async () => {
      // Desembolsar entrega dinero: es una operación interna con actor identificado, nunca del
      // titular. Ocultar el botón en la app no es un control de acceso.
      await request(app.getHttpServer())
        .post('/credit-applications/1/disbursement')
        .set(...authHeader('customer'))
        .set(...TENANT)
        .set(...IDEMPOTENCY)
        .send({})
        .expect(403);
      expect(disbursement.disburse).not.toHaveBeenCalled();
    });

    it('un cliente NO puede registrar cobros ni reversarlos', async () => {
      await request(app.getHttpServer())
        .post('/loans/10/payments')
        .set(...authHeader('customer'))
        .set(...TENANT)
        .set(...IDEMPOTENCY)
        .send({ amount: '100.00', currencyCode: 'BOB', paymentMethod: 'cash' })
        .expect(403);
      await request(app.getHttpServer())
        .post('/loans/10/payments/5/reversal')
        .set(...authHeader('customer'))
        .set(...TENANT)
        .send({ reasonCode: 'chargeback' })
        .expect(403);
      expect(payments.registerPayment).not.toHaveBeenCalled();
      expect(payments.reversePayment).not.toHaveBeenCalled();
    });

    it('castigar exige administrador: ni el operador interno puede dar por perdido un saldo', async () => {
      await request(app.getHttpServer())
        .post('/loans/10/write-off')
        .set(...authHeader('internal_operator'))
        .set(...TENANT)
        .send({ reasonCode: 'incobrable', notes: 'gestión agotada' })
        .expect(403);
      expect(writeOff.writeOff).not.toHaveBeenCalled();
    });

    it('el cliente SÍ puede leer la ficha de su préstamo', async () => {
      await request(app.getHttpServer())
        .get('/loans/10')
        .set(...authHeader('customer', { customerId: CLIENTE }))
        .set(...TENANT)
        .expect(200);
      expect(queries.detail).toHaveBeenCalled();
    });

    /*
      La otra mitad de la regla, que no estaba cubierta: el 403 del préstamo AJENO.

      Sin esta prueba, la comprobación de propiedad se puede borrar por accidente y la suite sigue
      en verde —el caso feliz pasa igual—. Y lo que se perdería es justo el hallazgo que motivó el
      cambio: leer la deuda, el comercio y la mora de cualquier cliente cambiando un número.
    */
    it('un cliente NO puede leer la ficha de un préstamo ajeno', async () => {
      await request(app.getHttpServer())
        .get('/loans/10')
        .set(...authHeader('customer', { customerId: '99' }))
        .set(...TENANT)
        .expect(403);
    });
  });

  describe('validación en el borde', () => {
    it('un cobro sin clave de idempotencia se rechaza antes de tocar el libro', async () => {
      // La pasarela reintenta. Sin clave, el reintento sería un segundo cobro real.
      await request(app.getHttpServer())
        .post('/loans/10/payments')
        .set(...authHeader('internal_operator'))
        .set(...TENANT)
        .send({ amount: '100.00', currencyCode: 'BOB', paymentMethod: 'cash' })
        .expect(400);
      expect(payments.registerPayment).not.toHaveBeenCalled();
    });

    it('rechaza un importe con más de dos decimales', async () => {
      await request(app.getHttpServer())
        .post('/loans/10/payments')
        .set(...authHeader('internal_operator'))
        .set(...TENANT)
        .set(...IDEMPOTENCY)
        .send({ amount: '100.005', currencyCode: 'BOB', paymentMethod: 'cash' })
        .expect(400);
      expect(payments.registerPayment).not.toHaveBeenCalled();
    });

    it('rechaza un importe numérico: el dinero viaja como texto', async () => {
      // `12345.67` ya llega a `JSON.parse` como binario flotante; el céntimo se pierde antes de
      // que el backend pueda hacer nada.
      await request(app.getHttpServer())
        .post('/loans/10/payments')
        .set(...authHeader('internal_operator'))
        .set(...TENANT)
        .set(...IDEMPOTENCY)
        .send({ amount: 100.0, currencyCode: 'BOB', paymentMethod: 'cash' })
        .expect(400);
      expect(payments.registerPayment).not.toHaveBeenCalled();
    });

    it('rechaza un importe de cero o negativo', async () => {
      for (const amount of ['0.00', '0']) {
        await request(app.getHttpServer())
          .post('/loans/10/payments')
          .set(...authHeader('internal_operator'))
          .set(...TENANT)
          .set(...IDEMPOTENCY)
          .send({ amount, currencyCode: 'BOB', paymentMethod: 'cash' })
          .expect(400);
      }
      expect(payments.registerPayment).not.toHaveBeenCalled();
    });

    it('rechaza un método de pago que no está en el catálogo', async () => {
      await request(app.getHttpServer())
        .post('/loans/10/payments')
        .set(...authHeader('internal_operator'))
        .set(...TENANT)
        .set(...IDEMPOTENCY)
        .send({ amount: '100.00', currencyCode: 'BOB', paymentMethod: 'cripto' })
        .expect(400);
    });

    it('reversar sin motivo se rechaza: un cobro que desaparece sin explicación es un descuadre', async () => {
      await request(app.getHttpServer())
        .post('/loans/10/payments/5/reversal')
        .set(...authHeader('internal_operator'))
        .set(...TENANT)
        .send({})
        .expect(400);
      expect(payments.reversePayment).not.toHaveBeenCalled();
    });

    it('castigar sin nota se rechaza', async () => {
      await request(app.getHttpServer())
        .post('/loans/10/write-off')
        .set(...authHeader('admin'))
        .set(...TENANT)
        .send({ reasonCode: 'incobrable' })
        .expect(400);
      expect(writeOff.writeOff).not.toHaveBeenCalled();
    });

    it('rechaza un identificador de préstamo que no es un id', async () => {
      await request(app.getHttpServer())
        .get('/loans/no-soy-un-id')
        .set(...authHeader('internal_operator'))
        .set(...TENANT)
        .expect(400);
    });

    it('el desembolso no admite cambiar el monto aprobado', async () => {
      // El monto y el plazo los aprobó la decisión; alterarlos al desembolsar convertiría la
      // aprobación en un trámite. El esquema es `strict`, así que un campo de más es un 400.
      await request(app.getHttpServer())
        .post('/credit-applications/1/disbursement')
        .set(...authHeader('internal_operator'))
        .set(...TENANT)
        .set(...IDEMPOTENCY)
        .send({ principalAmount: '999999.00' })
        .expect(400);
      expect(disbursement.disburse).not.toHaveBeenCalled();
    });
  });

  describe('camino feliz', () => {
    it('desembolsa y devuelve 201 con el préstamo creado', async () => {
      const response = await request(app.getHttpServer())
        .post('/credit-applications/1/disbursement')
        .set(...authHeader('internal_operator'))
        .set(...TENANT)
        .set(...IDEMPOTENCY)
        .send({ annualInterestRate: 24 })
        .expect(201);

      expect(response.body).toMatchObject({ loanId: '10', status: 'active' });
      const [[input]] = disbursement.disburse.mock.calls as unknown as [[{ tenantId: string; idempotencyKey: string }]];
      expect(input.tenantId).toBe('1');
      expect(input.idempotencyKey).toBe('idem-e2e-1');
    });

    it('registra un cobro y devuelve 201', async () => {
      await request(app.getHttpServer())
        .post('/loans/10/payments')
        .set(...authHeader('internal_operator'))
        .set(...TENANT)
        .set(...IDEMPOTENCY)
        .send({ amount: '1250.50', currencyCode: 'bob', paymentMethod: 'qr' })
        .expect(201);

      const calls = payments.registerPayment.mock.calls as unknown as [[{ body: { currencyCode: string } }]];
      // La moneda se normaliza en el borde: `bob` y `BOB` son la misma.
      expect(calls[calls.length - 1][0].body.currencyCode).toBe('BOB');
    });

    it('castiga un préstamo cuando lo pide un administrador', async () => {
      await request(app.getHttpServer())
        .post('/loans/10/write-off')
        .set(...authHeader('admin'))
        .set(...TENANT)
        .send({ reasonCode: 'incobrable', notes: 'gestión de cobranza agotada' })
        .expect(200);
      expect(writeOff.writeOff).toHaveBeenCalled();
    });
  });
});
