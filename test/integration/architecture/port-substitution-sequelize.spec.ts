/**
 * @file AT-051 — el adaptador Sequelize del outbox cumple el mismo contrato que el doble en memoria.
 * @business Si la base rechaza algo que el doble acepta (o al revés), se cambia el doble, nunca la base.
 * @system PostgreSQL real: cada caso corre dentro de una transacción que se revierte al terminar, así
 *   que el índice único parcial `ux_outbox_tenant_event_idempotency_key` decide el caso del dedupKey.
 */
import { afterAll, beforeAll } from '@jest/globals';
import type { Transaction } from 'sequelize';
import { OutboxEventModel } from '../../../src/database/models/index.js';
import { SequelizeOutboxWriter } from '../../../src/platform/events/sequelize-outbox-writer.js';
import { describeTransactionalOutboxContract } from '../../contracts/architecture/transactional-outbox.contract.js';
import { openIntegrationDatabase, type IntegrationDatabase } from '../support/database.js';

let database: IntegrationDatabase | null = null;

beforeAll(async () => {
  database = await openIntegrationDatabase();
});
afterAll(async () => {
  await database?.close();
});

describeTransactionalOutboxContract('SequelizeOutboxWriter (PostgreSQL, transacción revertida)', async () => {
  if (!database) throw new Error('la base de integración no está abierta (¿salto explícito?)');
  const transaction: Transaction = await database.sequelize.transaction();
  return {
    outbox: new SequelizeOutboxWriter(OutboxEventModel, transaction),
    dispose: () => transaction.rollback(),
  };
});
