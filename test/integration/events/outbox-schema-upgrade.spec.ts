/**
 * @file AT-022 — el sobre del evento y el inbox de recibos son compatibles con las filas heredadas.
 * @business Un evento pendiente escrito antes del cambio de esquema tiene que seguir siendo entregable;
 *   un consumidor no procesa dos veces el mismo evento; otro consumidor sí lo recibe.
 * @system PostgreSQL real tras la migración `20260911190000-outbox-envelope-and-inbox-receipts`:
 *   inserta una fila «legacy» (sin sobre) y comprueba los valores por defecto; ejercita la unicidad
 *   (consumer_id, event_id) del inbox con dos consumidores.
 */
import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { randomUUID } from 'node:crypto';
import { QueryTypes, UniqueConstraintError } from 'sequelize';
import { InboxReceiptModel, OutboxEventModel } from '../../../src/database/models/index.js';
import { openIntegrationDatabase, runToken, type IntegrationDatabase } from '../support/database.js';

let database: IntegrationDatabase | null = null;
const marker = `it-outbox-${runToken()}`;

beforeAll(async () => {
  database = await openIntegrationDatabase();
});

afterAll(async () => {
  if (database) {
    await InboxReceiptModel.destroy({ where: { producer: marker } });
    await OutboxEventModel.destroy({ where: { eventCode: marker } });
  }
  await database?.close();
});

describe('AT-022 · outbox con sobre e inbox de recibos', () => {
  it('una fila legacy (sin sobre) recibe event_id y schema_version por defecto y sigue siendo pendiente', async () => {
    if (!database) return;
    const now = new Date();
    // Sólo columnas anteriores a la migración: lo que escribiría un productor viejo.
    await database.sequelize.query(
      `INSERT INTO platform_ops.outbox_events (_tenant_id, aggregate_type, aggregate_id, event_code, event_payload_json, status, attempts, available_at, _created_at)
       VALUES (NULL, 'test', '1', $code, '{}'::jsonb, 'pending', 0, $now, $now)`,
      { bind: { code: marker, now } },
    );
    const rows = await database.sequelize.query<{ event_id: string; schema_version: number; producer: string | null; status: string }>(
      'SELECT event_id, schema_version, producer, status FROM platform_ops.outbox_events WHERE event_code = $code',
      { type: QueryTypes.SELECT, bind: { code: marker } },
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].event_id).toMatch(/^[0-9a-f-]{36}$/);
    expect(rows[0].schema_version).toBe(1);
    expect(rows[0].producer).toBeNull();
    expect(rows[0].status).toBe('pending');
  });

  it('el índice de recibos rechaza el duplicado del mismo consumidor y admite a otro consumidor', async () => {
    if (!database) return;
    const eventId = randomUUID();
    const now = new Date();
    const receipt = (consumerId: string) =>
      InboxReceiptModel.create({
        consumerId,
        eventId,
        producer: marker,
        status: 'processed',
        attempts: 1,
        lastError: null,
        processedAt: now,
        createdAtValue: now,
        updatedAtValue: now,
      });
    await receipt('notifications');
    await expect(receipt('notifications')).rejects.toBeInstanceOf(UniqueConstraintError);
    await expect(receipt('audit')).resolves.toBeDefined();
    expect(await InboxReceiptModel.count({ where: { eventId } })).toBe(2);
  });

  it('el event_id es único: dos filas del outbox no pueden compartir identidad global', async () => {
    if (!database) return;
    const now = new Date();
    const first = await OutboxEventModel.create({
      tenantId: null,
      aggregateType: 'test',
      aggregateId: '2',
      eventCode: marker,
      eventPayloadJson: {},
      status: 'pending',
      attempts: 0,
      availableAt: now,
      processedAt: null,
      lastError: null,
      correlationId: null,
      createdAtValue: now,
      updatedAtValue: now,
    });
    const eventId =
      (first as unknown as { eventId?: string }).eventId ??
      (
        await database.sequelize.query<{ event_id: string }>('SELECT event_id FROM platform_ops.outbox_events WHERE _id = $id', {
          type: QueryTypes.SELECT,
          bind: { id: first.id },
        })
      )[0].event_id;
    await expect(
      database.sequelize.query(
        `INSERT INTO platform_ops.outbox_events (_tenant_id, aggregate_type, aggregate_id, event_code, event_payload_json, status, attempts, available_at, _created_at, event_id)
         VALUES (NULL, 'test', '3', $code, '{}'::jsonb, 'pending', 0, $now, $now, $eventId)`,
        { bind: { code: marker, now, eventId } },
      ),
    ).rejects.toThrow(/Validation error|duplicate key/);
  });
});
