import { describe, expect, it, jest } from '@jest/globals';
import { asyncMock } from '../../support/jest-mocks.js';
import { decodeAuditCursor, encodeAuditCursor } from '../../../src/modules/audit/audit-cursor.js';
import { AuditFeedRepository } from '../../../src/modules/audit/audit-feed.repository.js';

/** Variante por cursor del feed unificado de auditoría: SQL crudo sobre la vista `audit_event_feed` (conexión mockeada). */
describe('AuditFeedRepository', () => {
  function buildRepo() {
    const sequelize = { query: asyncMock() };
    return { repo: new AuditFeedRepository(sequelize as never), sequelize };
  }

  describe('findCustomerAuditEventsWithCursor', () => {
    it('sin cursor no añade la cláusula de comparación ROW y pide limit+1', async () => {
      const { repo, sequelize } = buildRepo();
      (sequelize.query as jest.Mock).mockResolvedValue([] as never);
      const result = await repo.findCustomerAuditEventsWithCursor('t1', 'c1', { limit: 10 });
      const [sql, opts] = (sequelize.query as jest.Mock).mock.calls[0] as [string, { replacements: Record<string, unknown> }];
      expect(sql).not.toContain('< (:cursorOccurredAt');
      expect(opts.replacements.limitPlusOne).toBe(11);
      expect(result).toEqual({ items: [], nextCursor: null });
    });

    it('los cambios de datos sólo cuentan si la tabla es la del cliente: el record_id de otras tablas no es su id', async () => {
      const { repo, sequelize } = buildRepo();
      (sequelize.query as jest.Mock).mockResolvedValue([] as never);
      await repo.findCustomerAuditEventsWithCursor('t1', 'c1', { limit: 10 });
      const [sql, opts] = (sequelize.query as jest.Mock).mock.calls[0] as [string, { replacements: Record<string, unknown> }];
      expect(sql).toContain('target_type IN (:customerTables) AND target_id = :customerId');
      expect(opts.replacements.customerTables).toEqual(['customers', 'customer']);
    });

    it('con más filas que el límite recorta y emite nextCursor', async () => {
      const { repo, sequelize } = buildRepo();
      const rows = Array.from({ length: 3 }, (_, i) => ({
        source_table: 'auth_event',
        source_id: String(i),
        tenant_id: 't1',
        occurred_at: `2026-01-0${i + 1}`,
        actor_type: 'customer',
        event_type: 'login',
        target_type: 'customer',
        target_id: 'c1',
        payload_json: null,
      }));
      (sequelize.query as jest.Mock).mockResolvedValue(rows as never);
      const result = await repo.findCustomerAuditEventsWithCursor('t1', 'c1', { limit: 2 });
      expect(result.items).toHaveLength(2);
      expect(result.nextCursor).not.toBeNull();
      expect(decodeAuditCursor(result.nextCursor as string)).toMatchObject({ sourceTable: 'auth_event', sourceId: '1' });
    });

    it('con cursor añade la cláusula ROW y sus replacements', async () => {
      const { repo, sequelize } = buildRepo();
      (sequelize.query as jest.Mock).mockResolvedValue([] as never);
      const cursor = encodeAuditCursor({ occurredAt: '2026-01-05', sourceTable: 'auth_event', sourceId: '9' });
      await repo.findCustomerAuditEventsWithCursor('t1', 'c1', { limit: 10, cursor });
      const [sql, opts] = (sequelize.query as jest.Mock).mock.calls[0] as [string, { replacements: Record<string, unknown> }];
      expect(sql).toContain('< (:cursorOccurredAt, :cursorSourceTable, :cursorSourceId)');
      expect(opts.replacements).toMatchObject({ cursorSourceTable: 'auth_event', cursorSourceId: '9' });
    });
  });
});
