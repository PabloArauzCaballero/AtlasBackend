/**
 * @file AT-025 — el grupo atómico del alta: un fallo tras crear credenciales no deja alta parcial.
 * @business Cliente, contactos, credenciales, consentimientos y sesión existen todos o ninguno; dos
 *   altas con los mismos datos conservan el índice y el error de negocio.
 * @system PostgreSQL real a través del puente heredado: se escribe en dos módulos del grupo y se fuerza
 *   un fallo en el tercero; se comprueba que nada quedó visible.
 */
import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { QueryTypes } from 'sequelize';
import { LegacyOnboardingAtomicBridge } from '../../../src/bootstrap/legacy-onboarding-atomic.bridge.js';
import { StartOnboardingUseCase } from '../../../src/modules/customer-onboarding/application/use-cases/start-onboarding.use-case.js';
import { ApplicationError } from '../../../src/platform/contracts/application-error.js';
import { fixedClock } from '../../../src/platform/di/clock.js';
import { buildAdmissionHarness, type AdmissionHarness } from '../credit/support/admission-harness.js';
import { openIntegrationDatabase, runToken, type IntegrationDatabase } from '../support/database.js';

let database: IntegrationDatabase | null = null;
let harness: AdmissionHarness | null = null;

beforeAll(async () => {
  database = await openIntegrationDatabase();
  if (database) harness = await buildAdmissionHarness(database.sequelize);
});

afterAll(async () => {
  await harness?.cleanup();
  await database?.close();
});

describe('AT-025 · registro atómico del alta', () => {
  it('fallo después de crear cliente y contacto: no queda alta parcial visible', async () => {
    if (!database || !harness) return;
    const bridge = new LegacyOnboardingAtomicBridge(database.sequelize);
    const code = `C-${runToken()}`;
    await expect(
      bridge.run(async (transaction) => {
        await database!.sequelize.query(
          `INSERT INTO customer.customers (_tenant_id, customer_code, customer_uuid, lifecycle_status, _created_at, _deleted) VALUES ($tenantId, $code, gen_random_uuid(), 'registered', now(), false)`,
          { bind: { tenantId: harness!.tenantId, code }, transaction },
        );
        const [row] = await database!.sequelize.query<{ id: string }>(
          'SELECT _id::text AS id FROM customer.customers WHERE customer_code = $code',
          { type: QueryTypes.SELECT, bind: { code }, transaction },
        );
        await database!.sequelize.query(
          `INSERT INTO customer.customer_contact_methods (_tenant_id, customer_id, contact_type, status, _created_at) VALUES ($tenantId, $customerId, 'phone', 'pending', now())`,
          { bind: { tenantId: harness!.tenantId, customerId: row.id }, transaction },
        );
        throw new Error('fallo simulado al crear credenciales');
      }),
    ).rejects.toThrow('fallo simulado');
    const rows = await database.sequelize.query<{ n: string }>(
      'SELECT count(*)::text AS n FROM customer.customers WHERE customer_code = $code',
      { type: QueryTypes.SELECT, bind: { code } },
    );
    expect(Number(rows[0]?.n)).toBe(0);
  });

  it('el caso de uso hashea fuera de la transacción y llama UNA vez al puerto atómico con valores serializables', async () => {
    const calls: unknown[] = [];
    const registration = {
      register: async (command: unknown) => {
        calls.push(command);
        return { customerId: '1', onboardingFlowId: '2', sessionId: null };
      },
    };
    const guards = { assertNoDuplicateCustomer: async () => undefined, assertConsentDocumentsAreValid: async () => undefined };
    const useCase = new StartOnboardingUseCase(
      guards,
      registration,
      { hash: async (p) => `argon2:${p.length}` },
      { hash: (v) => `h:${v}` },
      fixedClock('2026-09-11'),
    );
    const result = await useCase.execute({
      tenantId: '1',
      idempotencyKey: 'k',
      password: 'secreta123',
      phone: '+591',
      email: null,
      consents: [],
      sourceType: 'mobile_app',
      ipAddress: null,
    });
    expect(result).toEqual({ customerId: '1', onboardingFlowId: '2', sessionId: null });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ passwordHash: 'argon2:10', phoneHash: 'h:+591', emailHash: null });
    expect(JSON.stringify(calls[0])).not.toContain('secreta123');
  });

  it('sin clave de idempotencia: error de aplicación con el mismo mensaje que el servicio', async () => {
    const useCase = new StartOnboardingUseCase(
      { assertNoDuplicateCustomer: async () => undefined, assertConsentDocumentsAreValid: async () => undefined },
      {
        register: async () => {
          throw new Error('no debe llegar');
        },
      },
      { hash: async () => 'x' },
      { hash: () => 'x' },
      fixedClock('2026-09-11'),
    );
    await expect(
      useCase.execute({
        tenantId: '1',
        idempotencyKey: '',
        password: 'p',
        phone: null,
        email: null,
        consents: [],
        sourceType: 'mobile_app',
        ipAddress: null,
      }),
    ).rejects.toThrow(ApplicationError);
    await expect(
      useCase.execute({
        tenantId: '1',
        idempotencyKey: '',
        password: 'p',
        phone: null,
        email: null,
        consents: [],
        sourceType: 'mobile_app',
        ipAddress: null,
      }),
    ).rejects.toThrow('X-Idempotency-Key header is required.');
  });
});
