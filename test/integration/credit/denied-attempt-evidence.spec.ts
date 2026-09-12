/**
 * @file AT-008 — una denegación deja evidencia y no crea solicitud; un fallo técnico no deja nada.
 * @business Un cliente que insiste sin cumplir tiene que dejar rastro auditable; y una decisión a
 *   medias por un fallo de infraestructura no puede parecer una decisión.
 * @system PostgreSQL real. Antes de la corrección la denegación se lanzaba DENTRO del callback de
 *   `sequelize.transaction`, así que la evaluación que el código decía haber escrito se revertía:
 *   la primera prueba contaba 0 evaluaciones.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, jest } from '@jest/globals';
import { UnprocessableEntityException } from '@nestjs/common';
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

describe('AT-008 · evidencia de denegación', () => {
  it('cliente inelegible: una evaluación auditable, cero solicitudes y el mismo error público', async () => {
    if (!harness) return;
    // Sin hechos cargados (cliente recién creado, sin credenciales ni documentos): inelegible de verdad.
    const customerId = await harness.createCustomer('under_review');

    await expect(
      harness.admission.persistApplication({
        tenantId: harness.tenantId,
        customerId,
        body: { ...body, productId: harness.productId },
        currentUser: customerUser(customerId),
        idempotencyKey: `k-${customerId}`,
      }),
    ).rejects.toThrow(UnprocessableEntityException);

    expect(await harness.countApplications(customerId)).toBe(0);
    expect(await harness.countEvaluations(customerId)).toBe(1);
    const rows = await harness.sequelize.query<{ eligible: boolean; reason_code: string | null }>(
      'SELECT eligible, reason_code FROM customer.customer_eligibility_evaluations WHERE customer_id = $customerId',
      { type: 'SELECT' as never, bind: { customerId } },
    );
    expect(rows[0]).toMatchObject({ eligible: false, reason_code: 'credit_application_requested' });
  });

  it('el error público conserva el código y los bloqueadores', async () => {
    if (!harness) return;
    const customerId = await harness.createCustomer('blocked');
    await expect(
      harness.admission.persistApplication({
        tenantId: harness.tenantId,
        customerId,
        body: { ...body, productId: harness.productId },
        currentUser: customerUser(customerId),
        idempotencyKey: `k-${customerId}`,
      }),
    ).rejects.toThrow(/^CUSTOMER_NOT_ELIGIBLE: ACCOUNT_NOT_ACTIVE/);
  });

  it('error de escritura de la solicitud: rollback completo, sin evaluación que aparente éxito', async () => {
    if (!harness) return;
    const customerId = await harness.createCustomer('active');
    jest.spyOn(harness.eligibilityRepository, 'loadFacts').mockResolvedValue(eligibleFacts());
    // El producto se «desactiva» sólo para la escritura: forzamos un fallo de restricción en la
    // inserción de la solicitud (product id inexistente viola la FK) con la evaluación ya escrita.
    jest.spyOn(harness.creditRepository, 'createApplication').mockRejectedValue(new Error('fallo simulado de escritura'));

    await expect(
      harness.admission.persistApplication({
        tenantId: harness.tenantId,
        customerId,
        body: { ...body, productId: harness.productId },
        currentUser: customerUser(customerId),
        idempotencyKey: `k-${customerId}`,
      }),
    ).rejects.toThrow('fallo simulado de escritura');

    expect(await harness.countApplications(customerId)).toBe(0);
    expect(await harness.countEvaluations(customerId)).toBe(0);
  });

  it('reintento con la misma clave tras una denegación: no multiplica solicitudes', async () => {
    if (!harness) return;
    const customerId = await harness.createCustomer('under_review');
    const attempt = () =>
      harness!.admission.persistApplication({
        tenantId: harness!.tenantId,
        customerId,
        body: { ...body, productId: harness!.productId },
        currentUser: customerUser(customerId),
        idempotencyKey: `k-${customerId}`,
      });
    await expect(attempt()).rejects.toThrow(UnprocessableEntityException);
    await expect(attempt()).rejects.toThrow(UnprocessableEntityException);
    expect(await harness.countApplications(customerId)).toBe(0);
    // Cada intento deja su evidencia: es la política que el código describe y que ahora se cumple.
    expect(await harness.countEvaluations(customerId)).toBe(2);
  });
});
