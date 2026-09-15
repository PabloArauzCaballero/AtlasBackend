/**
 * @file AT-059 — el registro de escritor único: quién manda, con qué época y qué pasa si alguien llega tarde.
 * @business Una transferencia sólo procede desde el dueño y la época que el solicitante vio; si otro ya
 *   transfirió, la segunda intentona no hace nada (no hay dos dueños). Con cola sin drenar hay que pedirlo
 *   explícitamente, para que nadie mueva la propiedad con trabajo en vuelo sin saberlo.
 * @system Doble de Sequelize (`query`/`transaction`); la variante contra PostgreSQL real vive en
 *   `test/integration/messaging/single-writer-cutover.spec.ts`.
 */
import { describe, expect, it, jest } from '@jest/globals';
import { ContextOwnershipRegistry, OwnershipFencedError } from '../../../src/platform/ownership/context-ownership.registry.js';
import type { Sequelize } from 'sequelize-typescript';

type Row = Record<string, unknown>;

/** Sequelize de mentira que responde por orden de aparición según lo que la consulta contiene. */
function fakeSequelize(answers: Array<{ match: string; rows: Row[] | [unknown, number] }>) {
  const seen: string[] = [];
  const query = jest.fn(async (sql: string) => {
    seen.push(sql);
    const answer = answers.find((candidate) => sql.includes(candidate.match));
    if (!answer) throw new Error(`consulta inesperada: ${sql.slice(0, 60)}`);
    return answer.rows;
  });
  const sequelize = {
    query,
    transaction: async <T>(run: (transaction: unknown) => Promise<T>) => run({}),
  } as unknown as Sequelize;
  return { sequelize, seen, query };
}

const OWNERSHIP_ROW = { context: 'messaging', owner: 'monolith', epoch: '3', changed_at: new Date('2026-09-12'), changed_by: 'migration' };

describe('registro de propiedad por contexto', () => {
  it('devuelve el dueño y la época vigentes, con la época como número', async () => {
    const { sequelize } = fakeSequelize([{ match: 'SELECT context, owner', rows: [OWNERSHIP_ROW] }]);
    const current = await new ContextOwnershipRegistry(sequelize).current('messaging');
    expect(current).toMatchObject({ context: 'messaging', owner: 'monolith', epoch: 3, changedBy: 'migration' });
  });

  it('un contexto sin fila devuelve null y `assertOwner` lanza cercado', async () => {
    const { sequelize } = fakeSequelize([{ match: 'SELECT context, owner', rows: [] }]);
    const registry = new ContextOwnershipRegistry(sequelize);
    expect(await registry.current('messaging')).toBeNull();
    await expect(registry.assertOwner('messaging', 'monolith')).rejects.toBeInstanceOf(OwnershipFencedError);
  });

  it('`assertOwner` devuelve la época al dueño y rechaza a cualquier otro', async () => {
    const { sequelize } = fakeSequelize([{ match: 'SELECT context, owner', rows: [OWNERSHIP_ROW] }]);
    const registry = new ContextOwnershipRegistry(sequelize);
    expect(await registry.assertOwner('messaging', 'monolith')).toBe(3);
    await expect(registry.assertOwner('messaging', 'messaging-worker')).rejects.toThrow(/OWNERSHIP_FENCED/);
  });

  it('sin conexión a la base no se inventa una respuesta', async () => {
    const registry = new ContextOwnershipRegistry();
    await expect(registry.current('messaging')).rejects.toThrow(/CONTEXT_OWNERSHIP_UNAVAILABLE/);
  });

  it('transferir con una época vieja no hace nada: otro ya movió la propiedad', async () => {
    const { sequelize, query } = fakeSequelize([{ match: 'FOR UPDATE', rows: [{ owner: 'monolith', epoch: '4' }] }]);
    const registry = new ContextOwnershipRegistry(sequelize);
    await expect(
      registry.transfer({ context: 'messaging', from: 'monolith', to: 'messaging-worker', expectedEpoch: 3, changedBy: 'test' }),
    ).rejects.toBeInstanceOf(OwnershipFencedError);
    // Ni cuenta eventos ni actualiza: se detiene en la comprobación.
    expect(query).toHaveBeenCalledTimes(1);
  });

  it('un contexto desconocido se rechaza con su nombre', async () => {
    const { sequelize } = fakeSequelize([{ match: 'FOR UPDATE', rows: [] }]);
    await expect(
      new ContextOwnershipRegistry(sequelize).transfer({
        context: 'ventas',
        from: 'monolith',
        to: 'x',
        expectedEpoch: 1,
        changedBy: 'test',
      }),
    ).rejects.toThrow(/OWNERSHIP_UNKNOWN_CONTEXT: ventas/);
  });

  it('con eventos en vuelo la transferencia se niega salvo que se pida el requeue explícito', async () => {
    const answers = [
      { match: 'FOR UPDATE', rows: [{ owner: 'monolith', epoch: '3' }] },
      { match: "status = 'processing'", rows: [{ n: '2' }] },
    ];
    const { sequelize } = fakeSequelize(answers);
    await expect(
      new ContextOwnershipRegistry(sequelize).transfer({
        context: 'messaging',
        from: 'monolith',
        to: 'messaging-worker',
        expectedEpoch: 3,
        changedBy: 'test',
      }),
    ).rejects.toThrow(/OWNERSHIP_QUEUE_NOT_DRAINED/);
  });

  it('con requeue explícito: devuelve los eventos en vuelo, sube la época y reporta cuántos reencoló', async () => {
    const { sequelize } = fakeSequelize([
      { match: 'FOR UPDATE', rows: [{ owner: 'monolith', epoch: '3' }] },
      { match: 'count(*)::text AS n FROM platform_ops.outbox_events', rows: [{ n: '2' }] },
      { match: 'UPDATE platform_ops.outbox_events', rows: [null, 2] },
      { match: 'UPDATE platform_ops.context_ownership', rows: [{ epoch: '4', changed_at: new Date('2026-09-12') }] },
    ]);
    const result = await new ContextOwnershipRegistry(sequelize).transfer({
      context: 'messaging',
      from: 'monolith',
      to: 'messaging-worker',
      expectedEpoch: 3,
      changedBy: 'runbook',
      requeueInFlight: true,
    });
    expect(result.requeued).toBe(2);
    expect(result.ownership).toMatchObject({ owner: 'messaging-worker', epoch: 4, changedBy: 'runbook' });
  });
});
