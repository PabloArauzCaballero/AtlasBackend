/**
 * @file AT-009 — recuperación concurrente de claves idempotentes con lease vencido.
 * @business Dos procesos que encuentran la misma clave vencida no pueden ejecutar los dos la misma
 *   mutación; y el que perdió, si despierta tarde, no puede pisar el resultado del que ganó.
 * @system PostgreSQL real, dos llamadas concurrentes sobre la misma fila. La barrera es la
 *   actualización condicional del almacén: bajo READ COMMITTED sólo una encaja. Antes de la
 *   corrección, el servicio leía la fila, la mutaba en memoria y hacía `save()`: las dos lecturas
 *   veían el lease vencido y las dos quedaban autorizadas.
 */
import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { ConflictException } from '@nestjs/common';
import { IdempotencyKeyModel, OutboxEventModel } from '../../../src/database/models/index.js';
import { IdempotencyClaimStore } from '../../../src/modules/runtime-hardening/infrastructure/idempotency-claim.store.js';
import { RuntimeHardeningService } from '../../../src/modules/runtime-hardening/runtime-hardening.service.js';
import type { IntegrationDatabase } from '../support/database.js';
import { openIntegrationDatabase, runToken } from '../support/database.js';

let database: IntegrationDatabase | null = null;
let service: RuntimeHardeningService;
const scope = `POST /api/v1/integration/${runToken()}`;
const request = { body: { amount: '10.00' }, query: {}, params: {} };

beforeAll(async () => {
  database = await openIntegrationDatabase();
  if (!database) return;
  service = new RuntimeHardeningService(IdempotencyKeyModel, OutboxEventModel, new IdempotencyClaimStore(IdempotencyKeyModel));
});

afterAll(async () => {
  if (database) await IdempotencyKeyModel.destroy({ where: { scope } });
  await database?.close();
});

function claim(idempotencyKey: string, now = new Date(), actorId: string | null = 'cust-1') {
  return service.claimIdempotency({ tenantScope: 'it', actorType: 'customer', actorId, idempotencyKey, scope, request, now });
}

async function insertExpired(idempotencyKey: string): Promise<IdempotencyKeyModel> {
  const past = new Date(Date.now() - 10 * 60_000);
  return IdempotencyKeyModel.create({
    tenantScope: 'it',
    actorType: 'customer',
    actorId: 'cust-1',
    idempotencyKey,
    scope,
    requestHash: service.requestHash(request.body, request.query, request.params),
    status: 'processing',
    responseStatus: null,
    responseBodyJson: null,
    lockedUntil: past,
    ownerToken: 'muerto',
    completedAt: null,
    createdAtValue: past,
    updatedAtValue: past,
  });
}

describe('AT-009 · carrera por un lease vencido', () => {
  it('dos claims simultáneos del mismo lease vencido: exactamente uno ejecuta, el otro ve la clave en curso', async () => {
    if (!database) return;
    const key = `k-${runToken()}`;
    await insertExpired(key);

    const results = await Promise.allSettled([claim(key), claim(key)]);

    const executes = results.filter((result) => result.status === 'fulfilled');
    const rejected = results.filter((result): result is PromiseRejectedResult => result.status === 'rejected');
    expect(executes).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0].reason).toBeInstanceOf(ConflictException);
    expect((rejected[0].reason as Error).message).toBe('IDEMPOTENCY_REQUEST_IN_PROGRESS');
    const row = await IdempotencyKeyModel.findOne({ where: { scope, idempotencyKey: key } });
    expect(row?.ownerToken).not.toBe('muerto');
    expect(row?.lockedUntil && row.lockedUntil.getTime() > Date.now()).toBe(true);
  });

  it('el dueño anterior completa DESPUÉS de que otro recuperó el lease: no sobrescribe el resultado vigente', async () => {
    if (!database) return;
    const key = `k-${runToken()}`;
    const row = await insertExpired(key);
    // El proceso viejo aún cree tener la concesión: su testigo es el que quedó grabado antes.
    const stale = { record: row, ownerToken: 'muerto' };

    const fresh = await claim(key);
    expect(fresh.mode).toBe('execute');
    if (fresh.mode !== 'execute') return;

    await service.completeIdempotency(stale, 500, { from: 'viejo' });
    await service.completeIdempotency(fresh.lease, 201, { from: 'nuevo' });

    const stored = await IdempotencyKeyModel.findOne({ where: { scope, idempotencyKey: key } });
    expect(stored?.status).toBe('completed');
    expect(stored?.responseStatus).toBe(201);
    expect(stored?.responseBodyJson).toEqual({ from: 'nuevo' });
  });

  it('el dueño anterior completa PRIMERO y el nuevo después: gana el testigo vigente, no el orden de llegada', async () => {
    if (!database) return;
    const key = `k-${runToken()}`;
    const row = await insertExpired(key);
    const stale = { record: row, ownerToken: 'muerto' };
    const fresh = await claim(key);
    if (fresh.mode !== 'execute') throw new Error('se esperaba execute');

    // El viejo intenta cerrar cuando ya no posee el testigo: 0 filas, sin excepción.
    await service.completeIdempotency(stale, 500, { from: 'viejo' });
    const afterStale = await IdempotencyKeyModel.findOne({ where: { scope, idempotencyKey: key } });
    expect(afterStale?.status).toBe('processing');

    await service.completeIdempotency(fresh.lease, 200, { from: 'nuevo' });
    const final = await IdempotencyKeyModel.findOne({ where: { scope, idempotencyKey: key } });
    expect(final?.responseBodyJson).toEqual({ from: 'nuevo' });
  });

  it('inserción inicial simultánea con la misma clave: uno ejecuta y el otro ve la clave en curso, sin 500', async () => {
    if (!database) return;
    const key = `k-${runToken()}`;

    const results = await Promise.allSettled([claim(key), claim(key)]);

    const executes = results.filter((result) => result.status === 'fulfilled');
    const rejected = results.filter((result): result is PromiseRejectedResult => result.status === 'rejected');
    expect(executes).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0].reason as Error).message).toBe('IDEMPOTENCY_REQUEST_IN_PROGRESS');
  });

  it('tras completar, la misma clave y petición del mismo actor recibe el replay; otro actor recibe conflicto', async () => {
    if (!database) return;
    const key = `k-${runToken()}`;
    const first = await claim(key);
    if (first.mode !== 'execute') throw new Error('se esperaba execute');
    await service.completeIdempotency(first.lease, 201, { purchaseId: 'p-1' });

    await expect(claim(key)).resolves.toEqual({ mode: 'replay', responseBody: { purchaseId: 'p-1' }, responseStatus: 201 });
    await expect(claim(key, new Date(), 'cust-2')).rejects.toThrow('IDEMPOTENCY_CONFLICT');
  });
});
