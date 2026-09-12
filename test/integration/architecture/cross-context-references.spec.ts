/**
 * @file AT-021 — referencias entre contextos: qué protege una FK física hoy y qué protege una regla
 *   cuando no la hay.
 * @business Antes de retirar una FK para separar bases hay que demostrar la garantía equivalente; y una
 *   referencia a una entidad inexistente nunca puede colarse como válida en silencio.
 * @system PostgreSQL real. Tres casos: FK física cruzada (telemetry→customer) rechaza el huérfano;
 *   referencia lógica sin FK (credit_applications→customers) la rechaza la admisión, no la base; el
 *   borrado lógico del cliente conserva su historial (auditoría), no lo destruye.
 */
import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { QueryTypes } from 'sequelize';
import { NotFoundException } from '@nestjs/common';
import { buildAdmissionHarness, customerUser, type AdmissionHarness } from '../credit/support/admission-harness.js';
import { openIntegrationDatabase, type IntegrationDatabase } from '../support/database.js';

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

describe('AT-021 · integridad referencial entre contextos', () => {
  it('FK física cruzada: una sesión que apunta a un cliente inexistente es rechazada por PostgreSQL', async () => {
    if (!database || !harness) return;
    await expect(
      database.sequelize.query(
        `INSERT INTO telemetry.customer_sessions (_tenant_id, customer_id, _created_at) VALUES ($tenantId, 999999999, now())`,
        { bind: { tenantId: harness.tenantId } },
      ),
    ).rejects.toThrow(/foreign key|violates|Validation error|not present/i);
  });

  it('referencia lógica SIN FK (solicitud → cliente): la protege la admisión, que no admite a un cliente inexistente', async () => {
    if (!database || !harness) return;
    // La base aceptaría la fila (credit_applications no tiene FK); el caso de uso no.
    await expect(
      harness.admission.persistApplication({
        tenantId: harness.tenantId,
        customerId: '999999999',
        body: { productId: harness.productId, requestedAmount: 1500, requestedTermMonths: 6 },
        currentUser: customerUser('999999999'),
        idempotencyKey: 'k-inexistente',
      }),
    ).rejects.toThrow(NotFoundException);
    expect(await harness.countApplications('999999999')).toBe(0);
  });

  it('borrado lógico del cliente: la fila y su historial siguen ahí para auditoría; no se destruye la trazabilidad', async () => {
    if (!database || !harness) return;
    const customerId = await harness.createCustomer('active');
    await database.sequelize.query(
      `INSERT INTO customer.customer_status_events (_tenant_id, customer_id, previous_status, new_status, reason_code, changed_by_type, happened_at, _created_at)
       VALUES ($tenantId, $customerId, 'active', 'closed', 'test', 'system', now(), now())`,
      { bind: { tenantId: harness.tenantId, customerId } },
    );
    await database.sequelize.query('UPDATE customer.customers SET _deleted = true WHERE _id = $customerId', { bind: { customerId } });
    const rows = await database.sequelize.query<{ n: string }>(
      'SELECT count(*)::text AS n FROM customer.customer_status_events WHERE customer_id = $customerId',
      { type: QueryTypes.SELECT, bind: { customerId } },
    );
    expect(Number(rows[0]?.n)).toBe(1);
    const customer = await database.sequelize.query<{ _deleted: boolean }>(
      'SELECT _deleted FROM customer.customers WHERE _id = $customerId',
      {
        type: QueryTypes.SELECT,
        bind: { customerId },
      },
    );
    expect(customer[0]?._deleted).toBe(true);
  });

  it('borrado físico de un cliente con historial: el comportamiento observado coincide con la regla de la FK (documentado, no deseado)', async () => {
    if (!database || !harness) return;
    const customerId = await harness.createCustomer('active');
    await database.sequelize.query(
      `INSERT INTO customer.customer_status_events (_tenant_id, customer_id, previous_status, new_status, reason_code, changed_by_type, happened_at, _created_at)
       VALUES ($tenantId, $customerId, 'active', 'active', 'test', 'system', now(), now())`,
      { bind: { tenantId: harness.tenantId, customerId } },
    );
    const rules = await database.sequelize.query<{ confdeltype: string }>(
      `SELECT c.confdeltype FROM pg_constraint c JOIN pg_class s ON s.oid = c.conrelid JOIN pg_class t ON t.oid = c.confrelid
       WHERE c.contype = 'f' AND s.relname = 'customer_status_events' AND t.relname = 'customers'`,
      { type: QueryTypes.SELECT },
    );
    const rule = rules[0]?.confdeltype ?? 'none';
    const attempt = database.sequelize.query('DELETE FROM customer.customers WHERE _id = $customerId', { bind: { customerId } });
    const remaining = async () =>
      Number(
        (
          await database!.sequelize.query<{ n: string }>(
            'SELECT count(*)::text AS n FROM customer.customer_status_events WHERE customer_id = $customerId',
            {
              type: QueryTypes.SELECT,
              bind: { customerId },
            },
          )
        )[0]?.n,
      );
    // Regla 'r'/'a' = RESTRICT/NO ACTION: la base impide destruir el historial. 'c' = CASCADE: lo destruye
    // (hallazgo para AT-021: antes de separar bases esa garantía la tiene que dar la retención lógica).
    if (rule === 'r' || rule === 'a') {
      await expect(attempt).rejects.toThrow(/foreign key|violates|Validation error|referenced/i);
      expect(await remaining()).toBe(1);
    } else if (rule === 'c') {
      await attempt;
      expect(await remaining()).toBe(0);
    } else if (rule === 'n') {
      // SET NULL: el historial sobrevive pero pierde el enlace al cliente. Es la regla vigente en
      // customer_status_events.customer_id: trazabilidad por tenant, no por cliente. Hallazgo para AT-021.
      await attempt;
      expect(await remaining()).toBe(0);
      const orphaned = await database.sequelize.query<{ n: string }>(
        "SELECT count(*)::text AS n FROM customer.customer_status_events WHERE _tenant_id = $tenantId AND customer_id IS NULL AND reason_code = 'test'",
        { type: QueryTypes.SELECT, bind: { tenantId: harness.tenantId } },
      );
      expect(Number(orphaned[0]?.n)).toBeGreaterThanOrEqual(1);
    } else {
      await attempt;
      expect(await remaining()).toBe(1);
    }
    expect(['r', 'a', 'c', 'n', 'd', 'none']).toContain(rule);
  });
});
