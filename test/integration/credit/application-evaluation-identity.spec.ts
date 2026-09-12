/**
 * @file AT-006 — cada solicitud de crédito enlaza la evaluación EXACTA que la autorizó.
 * @business Meses después hay que poder demostrar con qué información se aceptó una solicitud; si
 *   apunta a «la última» evaluación leída aparte, apunta a la de otro momento o a ninguna.
 * @system PostgreSQL real. Antes de la corrección, `getLatestEvaluation` se leía fuera de la
 *   transacción: con otra conexión y sin CLS no veía la fila recién insertada, así que la solicitud
 *   enlazaba la evaluación ANTERIOR (o `null`). Estas pruebas fallaban por eso.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, jest } from '@jest/globals';
import type { IntegrationDatabase } from '../support/database.js';
import { openIntegrationDatabase } from '../support/database.js';
import { buildAdmissionHarness, customerUser, eligibleFacts, type AdmissionHarness } from './support/admission-harness.js';

let database: IntegrationDatabase | null = null;
let harness: AdmissionHarness | null = null;

beforeAll(async () => {
  database = await openIntegrationDatabase();
  if (database) harness = await buildAdmissionHarness(database.sequelize);
});

// Los dobles de `loadFacts` no pueden sobrevivir a la prueba que los pidió: un cliente inelegible
// pasaría a elegible en la siguiente sin que nadie lo haya pedido.
afterEach(() => {
  jest.restoreAllMocks();
});

afterAll(async () => {
  await harness?.cleanup();
  await database?.close();
});

const body = { productId: '', requestedAmount: 1500, requestedTermMonths: 6 };

describe('AT-006 · identidad exacta de la evaluación', () => {
  it('existe una evaluación antigua: la solicitud nueva nunca apunta a ella', async () => {
    if (!harness) return; // salto explícito (ATLAS_GATES_ALLOW_SKIP): openIntegrationDatabase ya avisó
    const customerId = await harness.createCustomer('active');
    const user = customerUser(customerId);
    jest.spyOn(harness.eligibilityRepository, 'loadFacts').mockResolvedValue(eligibleFacts());

    // Evaluación previa, persistida y confirmada antes de la solicitud.
    const previous = await harness.eligibilityService.evaluateAndRecord({
      tenantId: harness.tenantId,
      customerId,
      evaluatedByType: 'customer',
      evaluatedByInternalUserId: null,
      decisionSource: 'automatic',
    });
    expect(await harness.latestEvaluationId(customerId)).toBe(previous.evaluationId);

    await harness.admission.persistApplication({
      tenantId: harness.tenantId,
      customerId,
      body: { ...body, productId: harness.productId },
      currentUser: user,
      idempotencyKey: `k-${customerId}`,
    });

    const [linked] = await harness.applicationEvaluationIds(customerId);
    const newest = await harness.latestEvaluationId(customerId);
    expect(await harness.countEvaluations(customerId)).toBe(2);
    expect(linked).toBe(newest);
    expect(linked).not.toBe(previous.evaluationId);
    expect(linked).not.toBe('null');
  });

  it('dos evaluaciones concurrentes del mismo cliente: cada resultado identifica su propia fila', async () => {
    if (!harness) return;
    const customerId = await harness.createCustomer('active');
    jest.spyOn(harness.eligibilityRepository, 'loadFacts').mockResolvedValue(eligibleFacts());
    const evaluate = () =>
      harness!.eligibilityService.evaluateAndRecord({
        tenantId: harness!.tenantId,
        customerId,
        evaluatedByType: 'customer',
        evaluatedByInternalUserId: null,
        decisionSource: 'automatic',
      });

    const [first, second] = await Promise.all([evaluate(), evaluate()]);

    expect(first.evaluationId).not.toBe(second.evaluationId);
    const rows = await harness.sequelize.query<{ id: string }>(
      'SELECT _id::text AS id FROM customer.customer_eligibility_evaluations WHERE customer_id = $customerId ORDER BY _id',
      { type: 'SELECT' as never, bind: { customerId } },
    );
    expect(rows.map((row) => row.id).sort()).toEqual([first.evaluationId, second.evaluationId].sort());
  });

  it('la persistencia de la evaluación falla: no aparece solicitud con referencia nula por fallback', async () => {
    if (!harness) return;
    const customerId = await harness.createCustomer('active');
    jest.spyOn(harness.eligibilityRepository, 'loadFacts').mockResolvedValue(eligibleFacts());
    // Fallo técnico DENTRO de la transacción, después de que la evaluación se haya insertado.
    const original = harness.eligibilityService.evaluateAndRecord.bind(harness.eligibilityService);
    jest.spyOn(harness.eligibilityService, 'evaluateAndRecord').mockImplementation(async (input) => {
      await original(input);
      throw new Error('fallo simulado al escribir la caché de elegibilidad');
    });

    await expect(
      harness.admission.persistApplication({
        tenantId: harness.tenantId,
        customerId,
        body: { ...body, productId: harness.productId },
        currentUser: customerUser(customerId),
        idempotencyKey: `k-${customerId}`,
      }),
    ).rejects.toThrow('fallo simulado');

    expect(await harness.countApplications(customerId)).toBe(0);
    // Rollback completo: tampoco queda una evaluación que aparente una decisión exitosa.
    expect(await harness.countEvaluations(customerId)).toBe(0);
  });
});
