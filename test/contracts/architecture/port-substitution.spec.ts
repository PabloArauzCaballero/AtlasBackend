/**
 * @file AT-051 — el doble en memoria del outbox cumple el MISMO contrato que el adaptador Sequelize.
 * @business Las pruebas de casos de uso que usan el doble sólo valen si el doble se comporta como la
 *   base en lo que el contrato promete; la suite compartida es la garantía, no la fe.
 * @system Ejecuta `describeTransactionalOutboxContract` con `InMemoryOutbox`; la misma suite corre
 *   contra `SequelizeOutboxWriter` en integración. Además fija que un doble permisivo (que acepta lo
 *   que la base rechaza) FALLA la suite: el contrato detecta el incumplimiento en vez de adaptarse.
 */
import { describe, expect, it } from '@jest/globals';
import { InMemoryOutbox } from '../../support/fakes/in-memory-outbox.js';
import type { OutboxAppend, TransactionalOutbox } from '../../../src/platform/events/transactional-outbox.port.js';
import { baseEvent, describeTransactionalOutboxContract } from './transactional-outbox.contract.js';

describeTransactionalOutboxContract('InMemoryOutbox', async () => ({ outbox: new InMemoryOutbox(), dispose: async () => undefined }));

/** Doble «complaciente»: acepta todo. Es el que NO debe pasar el contrato. */
class PermissiveOutbox implements TransactionalOutbox {
  private n = 0;
  async append(_event: OutboxAppend) {
    this.n += 1;
    return { eventId: `00000000-0000-4000-8000-${String(this.n).padStart(12, '0')}`, outboxRowId: String(this.n) };
  }
}

describe('AT-051 · un doble que acepta lo que la base rechaza no pasa el contrato', () => {
  it('la clave prohibida y el dedupKey repetido se aceptan en el doble complaciente: el contrato lo delata', async () => {
    const permissive = new PermissiveOutbox();
    await expect(permissive.append(baseEvent({ payload: { documentNumber: '1' } }))).resolves.toBeDefined();
    const dedupKey = 'dup';
    await permissive.append(baseEvent({ dedupKey }));
    await expect(permissive.append(baseEvent({ dedupKey }))).resolves.toBeDefined();
    // Las dos aserciones anteriores son exactamente las que la suite de contrato hace fallar; el doble
    // válido (InMemoryOutbox) rechaza ambas:
    const strict = new InMemoryOutbox();
    await expect(strict.append(baseEvent({ payload: { documentNumber: '1' } }))).rejects.toMatchObject({
      code: 'EVENT_FORBIDDEN_PAYLOAD_KEY',
    });
    await strict.append(baseEvent({ dedupKey }));
    await expect(strict.append(baseEvent({ dedupKey }))).rejects.toMatchObject({ code: 'OUTBOX_DEDUP_KEY_TAKEN' });
  });
});
