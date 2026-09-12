/**
 * @file AT-015 — la unidad de trabajo local garantiza la atomicidad sin filtrar `Transaction`.
 * @business Todo lo que un caso de uso escribe en una sesión se confirma junto o se revierte junto; y
 *   nadie puede seguir escribiendo con una sesión ya cerrada.
 * @system PostgreSQL real con el adaptador de Crédito y una segunda conexión que observa lo que la
 *   sesión aún no confirmó. La cobertura del puente heredado del alta se mide por su alcance
 *   declarado y por el rollback de un grupo de escrituras de dos módulos.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, jest } from '@jest/globals';
import { QueryTypes } from 'sequelize';
import { LEGACY_ONBOARDING_ATOMIC_SCOPE, LegacyOnboardingAtomicBridge } from '../../../src/bootstrap/legacy-onboarding-atomic.bridge.js';
import { CreditApplicationEventModel, CreditApplicationModel, CreditProductModel } from '../../../src/database/models/index.js';
import { CreditRepository } from '../../../src/modules/credit/credit.repository.js';
import { SequelizeCreditUnitOfWork } from '../../../src/modules/credit/infrastructure/persistence/sequelize-credit-unit-of-work.js';
import { UnitOfWorkClosedError } from '../../../src/platform/persistence/local-unit-of-work.js';
import { buildAdmissionHarness, eligibleFacts, type AdmissionHarness } from '../credit/support/admission-harness.js';
import type { IntegrationDatabase } from '../support/database.js';
import { openIntegrationDatabase } from '../support/database.js';

let database: IntegrationDatabase | null = null;
let harness: AdmissionHarness | null = null;
let unitOfWork: SequelizeCreditUnitOfWork;

beforeAll(async () => {
  database = await openIntegrationDatabase();
  if (!database) return;
  harness = await buildAdmissionHarness(database.sequelize);
  const creditRepository = new CreditRepository(CreditProductModel, CreditApplicationModel, CreditApplicationEventModel);
  unitOfWork = new SequelizeCreditUnitOfWork(
    database.sequelize,
    creditRepository,
    harness.eligibilityService,
    harness.eligibilityRepository,
  );
});

afterEach(() => {
  jest.restoreAllMocks();
});

afterAll(async () => {
  await harness?.cleanup();
  await database?.close();
});

function applicationValues(harness: AdmissionHarness, customerId: string, evaluationId: string, code: string) {
  const now = new Date();
  return {
    tenantId: harness.tenantId,
    applicationCode: code,
    customerId,
    creditProductId: harness.productId,
    partnerProfileId: null,
    posTerminalId: null,
    requestedAmount: '1500.00',
    requestedTermMonths: 6,
    currencyCode: 'BOB',
    purposeCode: null,
    status: 'submitted',
    eligibilityEvaluationId: evaluationId,
    eligibilitySnapshotJson: {},
    riskAssessmentRunId: null,
    decisionReasonCode: null,
    decidedAt: null,
    decidedByInternalUserId: null,
    idempotencyKeyHash: code,
    submittedAt: now,
    createdAtValue: now,
    updatedAtValue: now,
    deleted: false,
  };
}

describe('AT-015 · unidad de trabajo local de Crédito', () => {
  it('una escritura del callback falla: se revierten TODAS las escrituras de la sesión', async () => {
    if (!harness) return;
    const customerId = await harness.createCustomer('active');
    jest.spyOn(harness.eligibilityRepository, 'loadFacts').mockResolvedValue(eligibleFacts());

    await expect(
      unitOfWork.run(async (session) => {
        await session.eligibility.lockCustomer(harness!.tenantId, customerId);
        const evaluation = await session.eligibility.evaluateAndRecord({
          tenantId: harness!.tenantId,
          customerId,
          evaluatedByType: 'customer',
          evaluatedByInternalUserId: null,
          decisionSource: 'automatic',
        });
        await session.applications.createApplication(applicationValues(harness!, customerId, evaluation.evaluationId, `UOW-${customerId}`));
        throw new Error('fallo simulado en la última etapa');
      }),
    ).rejects.toThrow('fallo simulado');

    expect(await harness.countEvaluations(customerId)).toBe(0);
    expect(await harness.countApplications(customerId)).toBe(0);
  });

  it('lo escrito en la sesión no es visible desde otra conexión hasta el commit (la sesión SÍ está ligada)', async () => {
    if (!harness) return;
    const customerId = await harness.createCustomer('active');
    jest.spyOn(harness.eligibilityRepository, 'loadFacts').mockResolvedValue(eligibleFacts());
    let seenDuring = -1;
    await unitOfWork.run(async (session) => {
      const evaluation = await session.eligibility.evaluateAndRecord({
        tenantId: harness!.tenantId,
        customerId,
        evaluatedByType: 'customer',
        evaluatedByInternalUserId: null,
        decisionSource: 'automatic',
      });
      await session.applications.createApplication(applicationValues(harness!, customerId, evaluation.evaluationId, `UOW2-${customerId}`));
      // Segunda conexión (fuera de la transacción): todavía no debe ver la solicitud.
      seenDuring = await harness!.countApplications(customerId);
    });
    expect(seenDuring).toBe(0);
    expect(await harness.countApplications(customerId)).toBe(1);
  });

  it('usar la sesión después del callback lanza UNIT_OF_WORK_CLOSED y no escribe tarde', async () => {
    if (!harness) return;
    const customerId = await harness.createCustomer('active');
    let escaped: Awaited<Parameters<Parameters<typeof unitOfWork.run>[0]>[0]> | null = null;
    await unitOfWork.run(async (session) => {
      escaped = session;
    });
    expect(escaped).not.toBeNull();
    await expect(async () => {
      await escaped!.applications.createApplication(applicationValues(harness!, customerId, '1', `LATE-${customerId}`));
    }).rejects.toThrow(UnitOfWorkClosedError);
    expect(await harness.countApplications(customerId)).toBe(0);
  });

  it('la sesión no expone la transacción ni el ORM', async () => {
    if (!harness) return;
    await unitOfWork.run(async (session) => {
      expect(Object.keys(session).sort()).toEqual(['applications', 'eligibility']);
      expect('transaction' in session).toBe(false);
      expect('sequelize' in session).toBe(false);
    });
  });
});

describe('AT-015 · puente atómico heredado del alta', () => {
  it('declara alcance, dueño y tarea de retirada, y no se declara extraíble', () => {
    expect(LEGACY_ONBOARDING_ATOMIC_SCOPE.extractable).toBe(false);
    expect(LEGACY_ONBOARDING_ATOMIC_SCOPE.owner).toBe('datos');
    expect(LEGACY_ONBOARDING_ATOMIC_SCOPE.retirementTask).toMatch(/^AT-\d{3}$/);
    expect([...LEGACY_ONBOARDING_ATOMIC_SCOPE.modules]).toEqual(expect.arrayContaining(['auth', 'consents', 'customers', 'sessions']));
  });

  it('un fallo en cualquier etapa revierte las escrituras de los dos módulos del grupo', async () => {
    if (!harness || !database) return;
    const bridge = new LegacyOnboardingAtomicBridge(database.sequelize);
    const customerId = await harness.createCustomer('active');
    const sequelize = database.sequelize;
    await expect(
      bridge.run(async (transaction) => {
        // Etapa 1 (customers): evento de estado.
        await sequelize.query(
          `INSERT INTO customer.customer_status_events (_tenant_id, customer_id, previous_status, new_status, reason_code, changed_by_type, happened_at, _created_at)
           VALUES ($tenantId, $customerId, 'active', 'active', 'bridge_test', 'system', now(), now())`,
          { bind: { tenantId: harness!.tenantId, customerId }, transaction },
        );
        // Etapa 2 (consents): falla de restricción (documento inexistente).
        await sequelize.query(
          `INSERT INTO privacy.customer_consents (_tenant_id, customer_id, consent_document_id, status, _created_at)
           VALUES ($tenantId, $customerId, -1, 'granted', now())`,
          { bind: { tenantId: harness!.tenantId, customerId }, transaction },
        );
      }),
    ).rejects.toThrow();
    const rows = await sequelize.query<{ n: string }>(
      'SELECT count(*)::text AS n FROM customer.customer_status_events WHERE customer_id = $customerId',
      { type: QueryTypes.SELECT, bind: { customerId } },
    );
    expect(Number(rows[0]?.n)).toBe(0);
  });
});
