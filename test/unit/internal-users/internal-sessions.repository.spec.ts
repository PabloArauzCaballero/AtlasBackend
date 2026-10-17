import { describe, expect, it, jest } from '@jest/globals';
import { QueryTypes } from 'sequelize';
import { InternalSessionsRepository } from '../../../src/modules/internal-users/internal-sessions.repository.js';

/**
 * Lo que este repositorio decide con el SQL (vivo, del tenant, ordenado) se probó contra PostgreSQL real
 * (`docs/trabajo/2026-10-17-sesiones-activas-personal/evidencia/sql-contra-postgres.md`). Aquí se fija el
 * cableado: qué se le pasa a la base y cómo se lee lo que vuelve, incluido un recuento vacío.
 */
const AHORA = new Date('2026-10-17T12:00:00.000Z');

describe('InternalSessionsRepository', () => {
  it('listOpenSessions pasa tenant, instante y desplazamiento, y lee el recuento', async () => {
    const query = jest.fn(async (sql: unknown, _options?: unknown) =>
      String(sql).includes('COUNT(*)') ? [{ total: 7, people: 3 }] : [{ sessionId: '1' }],
    );
    const repository = new InternalSessionsRepository({ query } as never);

    const result = await repository.listOpenSessions('1', { page: 3, limit: 2 }, AHORA);

    expect(result).toEqual({ rows: [{ sessionId: '1' }], total: 7, people: 3 });
    expect(query).toHaveBeenCalledWith(expect.stringContaining('ORDER BY t.issued_at DESC, t._id DESC'), {
      replacements: { tenantId: '1', now: AHORA, limit: 2, offset: 4 },
      type: QueryTypes.SELECT,
    });
    expect(query).toHaveBeenCalledWith(expect.stringContaining('COUNT(DISTINCT t.actor_id)'), {
      replacements: { tenantId: '1', now: AHORA },
      type: QueryTypes.SELECT,
    });
  });

  it('listOpenSessions sin fila de recuento devuelve cero', async () => {
    const query = jest.fn(async () => []);
    const repository = new InternalSessionsRepository({ query } as never);
    await expect(repository.listOpenSessions('1', { page: 1, limit: 50 }, AHORA)).resolves.toEqual({ rows: [], total: 0, people: 0 });
  });

  it('revokeOpenSessions revoca sólo los de esa persona y cuenta las filas devueltas', async () => {
    const query = jest.fn(async (_sql: unknown, _options?: unknown) => [{ id: '1' }, { id: '3' }]);
    const repository = new InternalSessionsRepository({ query } as never);

    await expect(repository.revokeOpenSessions('5', 'admin_revoked', AHORA)).resolves.toBe(2);
    expect(query).toHaveBeenCalledWith(expect.stringContaining("actor_type = 'internal_user' AND actor_id = :internalUserId"), {
      replacements: { internalUserId: '5', reason: 'admin_revoked', now: AHORA },
      type: QueryTypes.SELECT,
    });
  });
});
