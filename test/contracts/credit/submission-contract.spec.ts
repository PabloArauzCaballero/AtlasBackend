/**
 * @file AT-026 — el caso de uso de solicitud corre con dobles tipados, sin Nest ni Sequelize.
 * @business Mismas puertas, mismos códigos: producto inexistente, no ofertable, solicitud viva,
 *   inelegible; la solicitud conserva evaluationId, snapshot y versión de regla.
 * @system `SubmitCreditApplicationUseCase` con una unidad de trabajo en memoria y un reloj fijo.
 */
import { describe, expect, it } from '@jest/globals';
import {
  SubmitCreditApplicationUseCase,
  denialError,
} from '../../../src/modules/credit/application/use-cases/submit-credit-application.use-case.js';
import { ApplicationError, HTTP_STATUS_BY_KIND } from '../../../src/platform/contracts/application-error.js';
import { fixedClock } from '../../../src/platform/di/clock.js';

const product = {
  id: 1,
  productCode: 'P1',
  currencyCode: 'BOB',
  status: 'active',
  effectiveFrom: null,
  effectiveUntil: null,
  requiresManualReview: false,
  minAmount: '100',
  maxAmount: '10000',
  minTermMonths: 1,
  maxTermMonths: 24,
  minMonthlyIncome: null,
};
const facts = { financialAttributeValues: { monthly_income_declared: 8000 } };

function build(options: { eligible?: boolean; open?: boolean; product?: typeof product | null } = {}) {
  const created: Record<string, unknown>[] = [];
  const events: Record<string, unknown>[] = [];
  let closed = false;
  const session = {
    applications: {
      findProductById: async () => (options.product === undefined ? product : options.product),
      findOpenApplication: async () => (options.open ? { id: 9 } : null),
      createApplication: async (values: Record<string, unknown>) => {
        created.push(values);
        return { id: 42, ...values };
      },
      createApplicationEvent: async (values: Record<string, unknown>) => {
        events.push(values);
        return values;
      },
    },
    eligibility: {
      lockCustomer: async () => undefined,
      loadFacts: async () => facts,
      evaluateAndRecord: async () => ({
        eligible: options.eligible ?? true,
        blockers: options.eligible === false ? [{ code: 'FRAUD_CASE_OPEN' }] : [],
        ruleVersion: 'eligibility-v1',
        evaluatedAt: '2026-09-11T00:00:00.000Z',
        lifecycleStatus: 'active',
        evaluationId: 'ev-7',
      }),
    },
  };
  const unitOfWork = {
    run: async (work: (s: typeof session) => Promise<unknown>) => {
      const r = await work(session);
      closed = true;
      return r;
    },
  };
  const partners = { resolve: async () => ({ partnerProfileId: null, posTerminalId: null }) };
  const useCase = new SubmitCreditApplicationUseCase(unitOfWork as never, partners, fixedClock('2026-09-11T10:00:00.000Z'));
  return { useCase, created, events, closed: () => closed };
}

const input = {
  tenantId: '1',
  customerId: 'c1',
  body: { productId: '1', requestedAmount: 1500, requestedTermMonths: 6 } as never,
  actor: { role: 'customer', internalUserId: null },
  idempotencyKey: 'k',
};

describe('SubmitCreditApplicationUseCase (AT-026)', () => {
  it('admite: crea solicitud y evento con la evaluación exacta, snapshot y versión de regla, y devuelve valores', async () => {
    const { useCase, created, events } = build();
    const outcome = await useCase.execute(input);
    expect(outcome.admitted).toBe(true);
    if (!outcome.admitted) return;
    expect(created[0]).toMatchObject({
      eligibilityEvaluationId: 'ev-7',
      status: 'submitted',
      requestedAmount: '1500.00',
      submittedAt: new Date('2026-09-11T10:00:00.000Z'),
    });
    expect(created[0].eligibilitySnapshotJson).toMatchObject({ ruleVersion: 'eligibility-v1', eligible: true });
    expect(events[0]).toMatchObject({ eventType: 'submitted', payloadJson: { eligibilityEvaluationId: 'ev-7' } });
    expect(Object.isFrozen(outcome.application)).toBe(true);
    expect(outcome.application.submittedAt).toBe('2026-09-11T10:00:00.000Z');
  });

  it('inelegible: resultado admitted=false (sin lanzar), sin solicitud; la traducción pública es la de siempre', async () => {
    const { useCase, created } = build({ eligible: false });
    const outcome = await useCase.execute(input);
    expect(outcome.admitted).toBe(false);
    expect(created).toHaveLength(0);
    if (outcome.admitted) return;
    const error = denialError(outcome.evaluation);
    expect(error.message).toBe('CUSTOMER_NOT_ELIGIBLE: FRAUD_CASE_OPEN');
    expect(HTTP_STATUS_BY_KIND[error.kind]).toBe(422);
  });

  it.each([
    ['producto inexistente', { product: null }, 'CREDIT_PRODUCT_NOT_FOUND', 404],
    ['producto no ofertable', { product: { ...product, status: 'retired' } }, 'CREDIT_PRODUCT_NOT_AVAILABLE', 422],
    ['solicitud viva', { open: true }, 'CREDIT_APPLICATION_ALREADY_OPEN', 409],
  ])('%s → error de aplicación con el código y estado previos', async (_name, options, code, status) => {
    const { useCase } = build(options as never);
    await expect(useCase.execute(input)).rejects.toMatchObject({ code });
    const error = await useCase.execute(input).catch((e: ApplicationError) => e);
    expect(HTTP_STATUS_BY_KIND[(error as ApplicationError).kind]).toBe(status);
  });

  it('no importa Nest ni Sequelize: se construye y corre sin contenedor', () => {
    expect(typeof SubmitCreditApplicationUseCase).toBe('function');
    expect(build().useCase).toBeInstanceOf(SubmitCreditApplicationUseCase);
  });
});
