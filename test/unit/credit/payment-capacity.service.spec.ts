import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { Op } from 'sequelize';
import { PaymentCapacityService } from '../../../src/modules/credit/application/payment-capacity.service.js';
import type {
  BankStatementReviewModel,
  CustomerActivitySummaryModel,
  CustomerModel,
  IdentityVerificationAttemptModel,
  LoanInstallmentModel,
  LoanModel,
} from '../../../src/database/models/index.js';

/**
 * Las entradas de la propuesta de límite.
 *
 * Este servicio no decide nada: lee el expediente y arma lo que el modelo de capacidad necesita.
 * Justo por eso sus errores son invisibles —el número sale, sólo que mal—. Lo que se fija son las
 * cuatro lecturas que, si se rompen, mueven el límite de una persona real sin que nada falle.
 *
 * La primera: el extracto que cuenta es el último ANALIZADO, no el último subido. Uno rechazado o
 * en revisión no tiene evaluación, y tomar el más reciente sin mirar eso haría que subir un
 * documento malo BORRARA la capacidad ya medida con uno bueno; la evidencia vieja sigue siendo
 * evidencia hasta que otra la sustituya. La segunda: quien nunca pidió un crédito tiene
 * `onTimeRatio` NULO y no cero —no paga mal, simplemente no ha pagado—, y el dominio distingue las
 * dos cosas. La tercera: la mora del último año cuenta cuotas VENCIDAS y sin pagar, no las que se
 * pagaron tarde y ya están saldadas. La cuarta: las señales de fraude suman casos y revisiones
 * manuales abiertas, porque las dos dicen lo mismo aquí —hay una duda sin resolver sobre quién es
 * esta persona— y sobre esa duda no se escala ningún límite.
 */
const AHORA = new Date('2026-09-10T12:00:00Z');

type Doble = { findOne: jest.Mock; findAll: jest.Mock };

function doble(): Doble {
  return { findOne: jest.fn(async () => null), findAll: jest.fn(async () => []) };
}

function cuota(overrides: Record<string, unknown> = {}) {
  return { status: 'pending', dueDate: '2026-09-20', daysPastDue: 0, ...overrides };
}

describe('PaymentCapacityService', () => {
  let customers: Doble;
  let loans: Doble;
  let installments: Doble;
  let reviews: Doble;
  let activity: Doble;
  let identity: Doble;
  let service: PaymentCapacityService;

  beforeEach(() => {
    customers = doble();
    loans = doble();
    installments = doble();
    reviews = doble();
    activity = doble();
    identity = doble();
    service = new PaymentCapacityService(
      customers as unknown as typeof CustomerModel,
      loans as unknown as typeof LoanModel,
      installments as unknown as typeof LoanInstallmentModel,
      reviews as unknown as typeof BankStatementReviewModel,
      activity as unknown as typeof CustomerActivitySummaryModel,
      identity as unknown as typeof IdentityVerificationAttemptModel,
    );
  });

  /**
   * Las dos lecturas se ejercitan por su nombre y no a través de `assess`.
   *
   * `PaymentCapacityAssessment` publica la propuesta y sus techos, no las entradas con las que se
   * calculó: comprobar «el historial de pago es nulo y no cero» a través del límite propuesto
   * ataría cada caso a la fórmula del dominio, y el día que la política cambie fallarían veinte
   * pruebas que no hablan de la política. `private` es una marca de compilación; lo que se prueba
   * aquí es lo que este servicio LEE, que es lo único suyo.
   */
  type Interno = {
    statementCapacity(tenantId: string, customerId: string): Promise<Record<string, unknown>>;
    relationship(tenantId: string, customerId: string, now: Date): Promise<Record<string, unknown>>;
  };

  function interno(): Interno {
    return service as unknown as Interno;
  }

  function extracto() {
    return interno().statementCapacity('t1', 'c1');
  }

  function relacion() {
    return interno().relationship('t1', 'c1', AHORA);
  }

  describe('el extracto', () => {
    it('se busca el último ANALIZADO: uno rechazado no debe borrar la capacidad ya medida', async () => {
      await extracto();

      const condicion = reviews.findOne.mock.calls.at(-1)?.[0] as { where: Record<string, unknown>; order: unknown[] };
      expect(condicion.where).toMatchObject({ tenantId: 't1', customerId: 'c1', deleted: false });
      expect((condicion.where.affordabilityScore as Record<symbol, null>)[Op.ne]).toBeNull();
      expect(condicion.order).toEqual([['_created_at', 'DESC']]);
    });

    it('sin extracto analizado se declara no elegible y sin cifras, en vez de asumir ceros', async () => {
      const medida = await extracto();

      expect(medida.eligible).toBe(false);
      expect(medida.monthlyIncome).toBeNull();
      expect(medida.monthsComplete).toBeNull();
    });

    it('con extracto, los importes llegan como números y la elegibilidad exige un TRUE explícito', async () => {
      reviews.findOne.mockResolvedValueOnce({
        affordabilityEligible: true,
        maxAffordableInstallment: '1250.50',
        observedMonthlyIncome: '5000.00',
        monthlyObligations: '1200.00',
        incomeStabilityScore: 78,
        affordabilityScore: 65,
        affordabilityBand: 'B',
        monthsComplete: 4,
      } as never);

      const medida = await extracto();

      expect(medida).toEqual({
        eligible: true,
        maxAffordableInstallment: 1250.5,
        monthlyIncome: 5000,
        monthlyObligations: 1200,
        stabilityScore: 78,
        affordabilityScore: 65,
        band: 'B',
        monthsComplete: 4,
      });
    });

    it('una elegibilidad ausente NO es elegible: sólo un TRUE lo es', async () => {
      reviews.findOne.mockResolvedValueOnce({ affordabilityEligible: null, affordabilityScore: 40 } as never);

      const medida = await extracto();
      expect(medida.eligible).toBe(false);
    });

    it('un importe ilegible se declara nulo en vez de propagar NaN al modelo', async () => {
      reviews.findOne.mockResolvedValueOnce({
        affordabilityEligible: true,
        maxAffordableInstallment: 'x',
        observedMonthlyIncome: undefined,
        affordabilityScore: 50,
      } as never);

      const medida = await extracto();

      expect(medida.maxAffordableInstallment).toBeNull();
      expect(medida.monthlyIncome).toBeNull();
    });
  });

  describe('la relación con el cliente', () => {
    it('sin créditos, el historial de pago es NULO y no cero: no ha pagado mal, no ha pagado', async () => {
      const evaluacion = await relacion();

      expect(evaluacion.onTimeRatio).toBeNull();
      expect(evaluacion.loansSettled).toBe(0);
      expect(evaluacion.monthsSinceLastLoan).toBeNull();
      expect(installments.findAll).not.toHaveBeenCalled();
    });

    it('la antigüedad se mide desde el alta y nunca es negativa', async () => {
      customers.findOne.mockResolvedValueOnce({ createdAtValue: new Date('2026-03-10T12:00:00Z') } as never);
      const seisMeses = await relacion();
      expect(seisMeses.tenureMonths).toBe(6);

      customers.findOne.mockResolvedValueOnce({ createdAtValue: new Date('2026-09-20T12:00:00Z') } as never);
      const futuro = await relacion();
      expect(futuro.tenureMonths).toBe(0);
    });

    it('sin cliente en la base la antigüedad es cero y no NaN', async () => {
      const evaluacion = await relacion();
      expect(evaluacion.tenureMonths).toBe(0);
    });

    it('la puntualidad se calcula sobre cuotas PAGADAS: una tarde y saldada cuenta como tarde', async () => {
      loans.findAll.mockResolvedValueOnce([{ id: 1, status: 'active', worstDaysPastDue: 0 }] as never);
      installments.findAll.mockResolvedValueOnce([
        cuota({ status: 'paid', daysPastDue: 0 }),
        cuota({ status: 'paid', daysPastDue: 0 }),
        cuota({ status: 'paid', daysPastDue: 5 }),
      ] as never);

      const evaluacion = await relacion();

      expect(evaluacion.onTimeRatio).toBeCloseTo(2 / 3);
    });

    it('con créditos pero ninguna cuota pagada, la puntualidad sigue siendo nula', async () => {
      loans.findAll.mockResolvedValueOnce([{ id: 1, status: 'active' }] as never);
      installments.findAll.mockResolvedValueOnce([cuota({ status: 'pending' })] as never);

      const evaluacion = await relacion();
      expect(evaluacion.onTimeRatio).toBeNull();
    });

    it('la mora del último año cuenta lo vencido SIN pagar, y sólo dentro de la ventana', async () => {
      loans.findAll.mockResolvedValueOnce([{ id: 1, status: 'active' }] as never);
      installments.findAll.mockResolvedValueOnce([
        cuota({ status: 'pending', dueDate: '2026-08-01' }),
        cuota({ status: 'pending', dueDate: '2024-01-01' }),
        cuota({ status: 'paid', dueDate: '2026-08-01', daysPastDue: 30 }),
        cuota({ status: 'pending', dueDate: '2026-12-01' }),
      ] as never);

      const evaluacion = await relacion();

      expect(evaluacion.delinquencyCount12m).toBe(1);
    });

    it('las cuotas se piden sólo para los créditos de ese cliente', async () => {
      loans.findAll.mockResolvedValueOnce([{ id: 1 }, { id: 2 }] as never);

      await relacion();

      const condicion = (installments.findAll.mock.calls.at(-1)?.[0] as { where: Record<string, unknown> }).where;
      expect(condicion.tenantId).toBe('t1');
      expect((condicion.loanId as Record<symbol, string[]>)[Op.in]).toEqual(['1', '2']);
    });

    it('separa los saldados de los activos y de los castigados', async () => {
      loans.findAll.mockResolvedValueOnce([
        { id: 1, status: 'closed' },
        { id: 2, status: 'settled' },
        { id: 3, status: 'active' },
        { id: 4, status: 'written_off' },
      ] as never);

      const evaluacion = await relacion();

      expect(evaluacion.loansSettled).toBe(2);
      expect(evaluacion.loansActive).toBe(1);
      expect(evaluacion.chargeOffCount).toBe(1);
    });

    it('la peor mora es la máxima de todos sus créditos', async () => {
      loans.findAll.mockResolvedValueOnce([
        { id: 1, status: 'closed', worstDaysPastDue: 12 },
        { id: 2, status: 'active', worstDaysPastDue: 45 },
        { id: 3, status: 'active', worstDaysPastDue: null },
      ] as never);

      const evaluacion = await relacion();
      expect(evaluacion.worstDaysPastDue).toBe(45);
    });

    it('los meses desde el último desembolso salen del más reciente, y son nulos si nunca hubo', async () => {
      loans.findAll.mockResolvedValueOnce([
        { id: 1, status: 'closed', disbursedAt: new Date('2026-01-10T12:00:00Z') },
        { id: 2, status: 'closed', disbursedAt: new Date('2026-06-10T12:00:00Z') },
      ] as never);
      const conDesembolso = await relacion();
      expect(conDesembolso.monthsSinceLastLoan).toBe(3);

      loans.findAll.mockResolvedValueOnce([{ id: 1, status: 'closed', disbursedAt: null }] as never);
      const sinDesembolso = await relacion();
      expect(sinDesembolso.monthsSinceLastLoan).toBeNull();
    });

    it('el KYC sólo está completo si el último intento salió verificado', async () => {
      identity.findOne.mockResolvedValueOnce({ finalResult: 'verified' } as never);
      await expect(relacion()).resolves.toHaveProperty('kycComplete', true);

      identity.findOne.mockResolvedValueOnce({ finalResult: 'pending_review' } as never);
      await expect(relacion()).resolves.toHaveProperty('kycComplete', false);

      await expect(relacion()).resolves.toHaveProperty('kycComplete', false);
    });

    it('las señales de fraude suman los casos de por vida y las revisiones manuales abiertas', async () => {
      activity.findOne.mockResolvedValueOnce({ fraudCaseCountLifetime: 1, openManualReviewCount: 2 } as never);

      const evaluacion = await relacion();
      expect(evaluacion.fraudFlags).toBe(3);
    });

    it('sin resumen de actividad no se inventan señales', async () => {
      const evaluacion = await relacion();
      expect(evaluacion.fraudFlags).toBe(0);
    });
  });

  describe('la propuesta', () => {
    it('lleva los cuatro techos y la versión del modelo: sin ella, dos propuestas no se comparan', async () => {
      const evaluacion = await service.assess({
        tenantId: 't1',
        customerId: 'c1',
        declaredMonthlyIncome: 4000,
        currentLimit: 2000,
        now: AHORA,
      });

      expect(evaluacion.ceilings).toEqual(
        expect.objectContaining({ byCapacity: expect.anything(), byRelationship: expect.any(Number), product: expect.any(Number) }),
      );
      expect(evaluacion.modelVersion).toEqual(expect.any(String));
      expect(evaluacion.bindingConstraint).toEqual(expect.any(String));
    });

    it('sin extracto, la propuesta se apoya en lo DECLARADO y lo dice', async () => {
      const evaluacion = await service.assess({
        tenantId: 't1',
        customerId: 'c1',
        declaredMonthlyIncome: 4000,
        currentLimit: null,
        now: AHORA,
      });

      expect(evaluacion.evidence).toBe('DECLARADO');
    });

    it('con extracto elegible se apoya en el EXTRACTO', async () => {
      reviews.findOne.mockResolvedValueOnce({
        affordabilityEligible: true,
        maxAffordableInstallment: '800.00',
        observedMonthlyIncome: '5000.00',
        monthlyObligations: '1000.00',
        incomeStabilityScore: 80,
        affordabilityScore: 70,
        affordabilityBand: 'A',
        monthsComplete: 6,
      } as never);

      const evaluacion = await service.assess({
        tenantId: 't1',
        customerId: 'c1',
        declaredMonthlyIncome: 4000,
        currentLimit: null,
        now: AHORA,
      });

      expect(evaluacion.evidence).toBe('EXTRACTO');
      expect(evaluacion.ceilings.byCapacity).not.toBeNull();
    });

    it('el plazo del cuerpo manda sobre el de la política: un plazo mayor levanta el techo por capacidad', async () => {
      const extractoElegible = {
        affordabilityEligible: true,
        maxAffordableInstallment: '800.00',
        observedMonthlyIncome: '5000.00',
        monthlyObligations: '1000.00',
        incomeStabilityScore: 80,
        affordabilityScore: 70,
        affordabilityBand: 'A',
        monthsComplete: 6,
      };
      reviews.findOne.mockResolvedValueOnce(extractoElegible as never);
      const largo = await service.assess({
        tenantId: 't1',
        customerId: 'c1',
        declaredMonthlyIncome: null,
        currentLimit: null,
        termMonths: 12,
        now: AHORA,
      });

      reviews.findOne.mockResolvedValueOnce(extractoElegible as never);
      const corto = await service.assess({
        tenantId: 't1',
        customerId: 'c1',
        declaredMonthlyIncome: null,
        currentLimit: null,
        termMonths: 3,
        now: AHORA,
      });

      expect(Number(largo.ceilings.byCapacity)).toBeGreaterThan(Number(corto.ceilings.byCapacity));
    });
  });
});
