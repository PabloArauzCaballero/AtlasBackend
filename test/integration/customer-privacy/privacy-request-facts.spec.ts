/**
 * @file Los hechos con los que el Motor decide una solicitud del titular, leídos de PostgreSQL real.
 * @business Un saldo mal sumado acepta un borrado con deuda; una ventana mal puesta manda a revisión a cada cliente
 *   nuevo. Las cifras se comprueban contra filas sembradas, no contra dobles.
 * @system Siembra en una transacción que se deshace (FK en pausa sólo dentro de ella) una cuenta que activa cada
 *   señal y otra recién dada de alta que no activa ninguna, y compara `PrivacyRequestFactsRepository.hechos` con lo
 *   calculado a mano.
 */
import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { Sequelize } from 'sequelize-typescript';
import { buildMigrationSequelizeOptions } from '../../../src/config/database.config.js';
import { PrivacyRequestFactsRepository } from '../../../src/modules/customer-privacy/application/privacy-request-facts.repository.js';
import { integrationSkipRequested } from '../support/database.js';
import { requireIsolatedDatabase } from '../../support/isolated-database.guard.js';

// Identificadores altos y propios: la transacción se deshace, pero mientras vive no debe pisar filas de otra prueba.
const TENANT = '880001';
const VIEJA = '880053';
const NUEVA = '880054';
const RECHAZADA = '880055';
let db: Sequelize | null = null;
let skipped = false;

const SIEMBRA = `
SET LOCAL session_replication_role = replica;
INSERT INTO iam.tenants (_id, _created_at) VALUES (${TENANT}, now());
INSERT INTO customer.customers (_id, _tenant_id, lifecycle_status, _created_at) VALUES
  (${VIEJA}, ${TENANT}, 'active', now() - interval '30 days'), (${NUEVA}, ${TENANT}, 'onboarding_in_progress', now() - interval '2 days'),
  (${RECHAZADA}, ${TENANT}, 'under_review', now() - interval '20 days');
INSERT INTO customer.customer_contact_methods (_tenant_id, customer_id, contact_type, _created_at) VALUES
  (${TENANT}, ${VIEJA}, 'email', now() - interval '30 days'), (${TENANT}, ${VIEJA}, 'phone', now() - interval '3 days'),
  (${TENANT}, ${NUEVA}, 'phone', now() - interval '2 days');
INSERT INTO telemetry.customer_sessions (_tenant_id, customer_id, device_id, started_at, _created_at) VALUES
  (${TENANT}, ${VIEJA}, 7, now() - interval '20 days', now()), (${TENANT}, ${VIEJA}, 7, now() - interval '1 day', now()),
  (${TENANT}, ${VIEJA}, 8, now() - interval '2 days', now()), (${TENANT}, ${NUEVA}, 9, now() - interval '1 day', now());
INSERT INTO case_management.fraud_cases (_tenant_id, customer_id, case_status, _created_at) VALUES
  (${TENANT}, ${VIEJA}, 'open', now()), (${TENANT}, ${NUEVA}, 'closed', now());
-- «Necesita más investigación» deja el caso en in_progress CON closed_at puesto (fraud.service.ts): sigue abierto.
INSERT INTO case_management.fraud_cases (_tenant_id, customer_id, case_status, closed_at, _created_at) VALUES
  (${TENANT}, ${RECHAZADA}, 'in_progress', now(), now());
-- PIN restablecido hace 2 días y una solicitud creada por el titular (880042) y otra por el equipo (880041).
INSERT INTO audit.operational_audit_logs (_tenant_id, actor_type, action_code, target_type, target_id, occurred_at, _created_at) VALUES
  (${TENANT}, 'customer', 'auth.password_reset.success', 'actor', '${VIEJA}', now() - interval '2 days', now()),
  (${TENANT}, 'customer', 'privacy.data_subject_request.create', 'data_subject_request', '880042', now(), now()),
  (${TENANT}, 'compliance_analyst', 'privacy.data_subject_request.create', 'data_subject_request', '880041', now(), now());
INSERT INTO credit.loans (_id, _tenant_id, loan_code, customer_id, credit_application_id, credit_product_id, currency_code, principal_amount, term_months, status) VALUES
  (880500, ${TENANT}, 'IT-L-500', ${VIEJA}, 880001, 1, 'BOB', 900, 3, 'active'),
  (880501, ${TENANT}, 'IT-L-501', ${VIEJA}, 880002, 1, 'BOB', 300, 3, 'paid_off');
INSERT INTO credit.loan_installments (_id, _tenant_id, loan_id, installment_number, due_date, principal_amount, interest_amount, late_fee_amount, paid_principal, paid_interest, paid_late_fee, status, days_past_due) VALUES
  (880001, ${TENANT}, 880500, 1, current_date - 40, 300, 10, 5, 300, 10, 5, 'paid', 0),
  (880002, ${TENANT}, 880500, 2, current_date - 10, 300, 10, 2.5, 100, 0, 0, 'overdue', 10),
  (880003, ${TENANT}, 880500, 3, current_date + 20, 300, 10, 0, 0, 0, 0, 'pending', 0),
  (880004, ${TENANT}, 880501, 1, current_date - 90, 300, 0, 0, 300, 0, 0, 'paid', 0);
INSERT INTO credit.loan_payment_claims (_tenant_id, claim_code, loan_id, installment_id, customer_id, claimed_amount, status) VALUES
  (${TENANT}, 'IT-C-1', 880500, 880002, ${VIEJA}, 50, 'pending_verification');
INSERT INTO privacy.data_subject_requests (_id, _tenant_id, customer_id, request_type, status, rectification_field, requested_at, resolved_at, _created_at) VALUES
  (880041, ${TENANT}, ${VIEJA}, 'deletion', 'received', NULL, now(), NULL, now()),
  (880042, ${TENANT}, ${VIEJA}, 'deletion', 'in_progress', NULL, now(), NULL, now()),
  (880043, ${TENANT}, ${VIEJA}, 'rectification', 'completed', 'zone', now(), now() - interval '30 days', now()),
  (880044, ${TENANT}, ${VIEJA}, 'rectification', 'completed', 'zone', now(), now() - interval '400 days', now()),
  (880045, ${TENANT}, ${NUEVA}, 'rectification', 'received', 'zone', now(), NULL, now());
INSERT INTO credit.bank_statement_reviews (_tenant_id, customer_id, promised_by, status, _created_at) VALUES
  (${TENANT}, ${VIEJA}, now() + interval '1 day', 'processing', now());
INSERT INTO customer.identity_verification_attempts (_tenant_id, customer_id, final_result, _created_at) VALUES
  (${TENANT}, ${VIEJA}, 'VERIFIED', now() - interval '10 days'), (${TENANT}, ${VIEJA}, 'PENDING', now()),
  (${TENANT}, ${RECHAZADA}, 'REJECTED', now() - interval '5 days');
`;

beforeAll(async () => {
  requireIsolatedDatabase();
  const { retryAttempts, retryDelay, ...opciones } = buildMigrationSequelizeOptions();
  void retryAttempts;
  void retryDelay;
  // Pool de una conexión: la transacción manual tiene que alcanzar a todas las sentencias, incluidas las del repositorio.
  db = new Sequelize({ ...opciones, models: [], logging: false, pool: { max: 1, min: 1, idle: 10_000, acquire: 30_000 } });
  try {
    await db.authenticate();
  } catch (error) {
    await db.close().catch(() => undefined);
    db = null;
    if (integrationSkipRequested()) {
      skipped = true;
      return;
    }
    throw error;
  }
  await db.query('BEGIN');
  await db.query(SIEMBRA);
});

afterAll(async () => {
  await db?.query('ROLLBACK').catch(() => undefined);
  await db?.close().catch(() => undefined);
});

const hechos = (customerId: string, requestId: string, requestType: string, rectificationField: string | null) =>
  new PrivacyRequestFactsRepository(db!).hechos({
    tenantId: TENANT,
    customerId,
    requestId,
    requestType,
    rectificationField,
    now: new Date(),
  });

describe('PrivacyRequestFactsRepository contra PostgreSQL', () => {
  it('la cuenta vieja activa cada señal, con las cifras calculadas a mano', async () => {
    if (skipped) return;
    expect(await hechos(VIEJA, '880042', 'deletion', null)).toEqual({
      lifecycleStatus: 'active',
      // Un intento posterior todavía PENDING no tapa el VERIFIED anterior.
      identidadVerificada: true,
      evidenciaIdentidad: true,
      credencialRestablecida7d: true,
      creadaPorTitular: true,
      contactoCambiado7d: true,
      dispositivoNuevo7d: true,
      fraudeAbierto: true,
      casoAbierto: false,
      // La anterior (880041). Sólo cuentan las ANTERIORES: ésta no se cuenta a sí misma ni a la que llegó después.
      solicitudesIgualesAbiertas: 1,
      // Cuota 2: 300 + 10 + 2,5 − 100 = 212,5; cuota 3: 310. El préstamo pagado no suma.
      saldoPendiente: 522.5,
      prestamosActivos: 1,
      cuotasEnMora: 1,
      pagosEnConciliacion: 1,
      tuvoCredito: true,
      extractoEnRevision: true,
      cambiosDelCampo365d: 0,
    });
  });

  it('dos borrados a la vez no se rechazan entre sí: la primera no ve a la segunda', async () => {
    if (skipped) return;
    expect((await hechos(VIEJA, '880041', 'deletion', null))?.solicitudesIgualesAbiertas).toBe(0);
    expect((await hechos(VIEJA, '880042', 'deletion', null))?.solicitudesIgualesAbiertas).toBe(1);
  });

  it('las correcciones del mismo dato cuentan sólo las cerradas en el último año', async () => {
    if (skipped) return;
    const h = await hechos(VIEJA, '880099', 'rectification', 'zone');
    expect(h?.cambiosDelCampo365d).toBe(1);
    expect(h?.solicitudesIgualesAbiertas).toBe(0);
  });

  it('una cuenta recién dada de alta no es «contacto nuevo» ni «dispositivo nuevo»: es su primer teléfono', async () => {
    if (skipped) return;
    expect(await hechos(NUEVA, '880045', 'rectification', 'zone')).toMatchObject({
      lifecycleStatus: 'onboarding_in_progress',
      identidadVerificada: false,
      evidenciaIdentidad: false,
      credencialRestablecida7d: false,
      creadaPorTitular: false,
      contactoCambiado7d: false,
      dispositivoNuevo7d: false,
      fraudeAbierto: false,
      saldoPendiente: 0,
      tuvoCredito: false,
    });
  });

  it('quien subió evidencia y fue rechazado no está verificado pero SÍ tiene evidencia que se retiene (M-02)', async () => {
    if (skipped) return;
    expect(await hechos(RECHAZADA, '880098', 'deletion', null)).toMatchObject({
      lifecycleStatus: 'under_review',
      identidadVerificada: false,
      evidenciaIdentidad: true,
      // in_progress con closed_at: un caso «en más investigación» sigue abierto.
      fraudeAbierto: true,
    });
  });

  it('lo que creó alguien del equipo NO cuenta como pedido por el titular', async () => {
    if (skipped) return;
    expect((await hechos(VIEJA, '880041', 'deletion', null))?.creadaPorTitular).toBe(false);
  });

  it('un cliente que no existe devuelve null, no una cuenta vacía', async () => {
    if (skipped) return;
    expect(await hechos('880999', '1', 'deletion', null)).toBeNull();
  });
});
