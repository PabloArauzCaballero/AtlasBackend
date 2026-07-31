import { describe, expect, it, jest } from '@jest/globals';
import { asyncMock, callArg, type CallArgRecord } from '../../support/jest-mocks.js';
import { Op } from 'sequelize';
import { AuditRepository, decodeAuditCursor, encodeAuditCursor } from '../../../src/modules/audit/audit.repository.js';
import type { AuditQueryDto } from '../../../src/modules/audit/audit.schemas.js';

/**
 * Cobertura directa de `AuditRepository` (Fase 1.2 del plan 10/10). El repositorio de auditoría
 * consolidada no tenía spec propio: fusiona 8 fuentes de eventos con ramas por `eventType`, un
 * builder de rango de fechas y una variante por cursor sobre SQL crudo. Servicio y controller lo
 * mockean, así que sus ramas no se ejercitaban. Modelos Sequelize + conexión mockeados.
 */
describe('AuditRepository', () => {
  function buildRepo() {
    const make = () => ({ findAll: asyncMock().mockResolvedValue([] as never) });
    const models = {
      operationalAuditLog: make(),
      dataChangeLog: make(),
      customerStatusEvent: make(),
      customerActionLog: make(),
      authEvent: make(),
      consentEvent: make(),
      manualReviewEvent: make(),
      fraudCaseEvent: make(),
      customerConsent: make(),
      manualReviewCase: make(),
      fraudCase: make(),
    };
    const sequelize = { query: asyncMock() };
    const repo = new AuditRepository(
      models.operationalAuditLog as never,
      models.dataChangeLog as never,
      models.customerStatusEvent as never,
      models.customerActionLog as never,
      models.authEvent as never,
      models.consentEvent as never,
      models.manualReviewEvent as never,
      models.fraudCaseEvent as never,
      models.customerConsent as never,
      models.manualReviewCase as never,
      models.fraudCase as never,
      sequelize as never,
    );
    return { repo, models, sequelize };
  }

  const baseQuery = (over: Partial<AuditQueryDto> = {}): AuditQueryDto => ({ eventType: 'all', page: 1, limit: 50, ...over });

  describe('findCustomerAuditEvents', () => {
    it('con eventType=status solo consulta la fuente de estado y mapea el resumen', async () => {
      const { repo, models } = buildRepo();
      (models.customerStatusEvent.findAll as jest.Mock).mockResolvedValue([
        { happenedAt: new Date('2026-01-02'), changedByType: 'internal', previousStatus: 'pending', newStatus: 'active', reasonCode: 'ok' },
      ] as never);
      const result = await repo.findCustomerAuditEvents('t1', 'c1', baseQuery({ eventType: 'status' }));
      expect(models.customerStatusEvent.findAll).toHaveBeenCalledTimes(1);
      expect(models.authEvent.findAll).not.toHaveBeenCalled();
      expect(result).toEqual([
        expect.objectContaining({ eventType: 'status', actorType: 'internal', summary: 'Estado: pending -> active' }),
      ]);
    });

    it('el resumen de estado cae a "none" cuando no hay previousStatus', async () => {
      const { repo, models } = buildRepo();
      (models.customerStatusEvent.findAll as jest.Mock).mockResolvedValue([
        { happenedAt: new Date('2026-01-02'), changedByType: null, previousStatus: null, newStatus: 'active', reasonCode: null },
      ] as never);
      const [event] = await repo.findCustomerAuditEvents('t1', 'c1', baseQuery({ eventType: 'status' }));
      expect(event.summary).toBe('Estado: none -> active');
    });

    it('aplica el rango de fechas [from,to] al where de la fuente', async () => {
      const { repo, models } = buildRepo();
      await repo.findCustomerAuditEvents(
        't1',
        'c1',
        baseQuery({ eventType: 'status', from: '2026-01-01T00:00:00.000Z', to: '2026-02-01T00:00:00.000Z' }),
      );
      const where = callArg<CallArgRecord>(models.customerStatusEvent.findAll, 0, 0).where as unknown as {
        happenedAt: Record<symbol, Date>;
      };
      expect(where.happenedAt[Op.gte]).toEqual(new Date('2026-01-01T00:00:00.000Z'));
      expect(where.happenedAt[Op.lte]).toEqual(new Date('2026-02-01T00:00:00.000Z'));
    });

    it('sin from/to no añade filtro de fecha', async () => {
      const { repo, models } = buildRepo();
      await repo.findCustomerAuditEvents('t1', 'c1', baseQuery({ eventType: 'auth' }));
      const where = callArg<CallArgRecord>(models.authEvent.findAll, 0, 0).where as Record<string, unknown>;
      expect(where.occurredAt).toBeUndefined();
    });

    it('data_change filtra por recordId=customerId y compone el resumen tabla:tipo', async () => {
      const { repo, models } = buildRepo();
      (models.dataChangeLog.findAll as jest.Mock).mockResolvedValue([
        { changedAt: new Date('2026-01-03'), changedByType: 'system', tableName: 'customers', changeType: 'update', changeReason: 'x' },
      ] as never);
      const [event] = await repo.findCustomerAuditEvents('t1', 'c1', baseQuery({ eventType: 'data_change' }));
      expect(callArg<CallArgRecord>(models.dataChangeLog.findAll, 0, 0).where).toMatchObject({ recordId: 'c1' });
      expect(event.summary).toBe('customers:update');
    });

    it('consent no consulta eventos cuando el cliente no tiene consentimientos', async () => {
      const { repo, models } = buildRepo();
      (models.customerConsent.findAll as jest.Mock).mockResolvedValue([] as never);
      const result = await repo.findCustomerAuditEvents('t1', 'c1', baseQuery({ eventType: 'consent' }));
      expect(models.consentEvent.findAll).not.toHaveBeenCalled();
      expect(result).toEqual([]);
    });

    it('consent resuelve los ids padres y filtra los eventos con Op.in', async () => {
      const { repo, models } = buildRepo();
      (models.customerConsent.findAll as jest.Mock).mockResolvedValue([{ id: 5 }, { id: 6 }] as never);
      (models.consentEvent.findAll as jest.Mock).mockResolvedValue([
        { happenedAt: new Date('2026-01-04'), triggeredByType: 'customer', eventType: 'granted', notes: null },
      ] as never);
      const [event] = await repo.findCustomerAuditEvents('t1', 'c1', baseQuery({ eventType: 'consent' }));
      const where = callArg<CallArgRecord>(models.consentEvent.findAll, 0, 0).where as unknown as {
        customerConsentId: Record<symbol, unknown>;
      };
      expect(where.customerConsentId[Op.in]).toEqual([5, 6]);
      expect(event.eventType).toBe('consent');
    });

    it('eventType=all consulta todas las fuentes y ordena por fecha desc', async () => {
      const { repo, models } = buildRepo();
      (models.authEvent.findAll as jest.Mock).mockResolvedValue([
        { occurredAt: new Date('2026-01-01'), eventType: 'login', loginSuccessful: true, failureReasonCode: null },
      ] as never);
      (models.customerStatusEvent.findAll as jest.Mock).mockResolvedValue([
        { happenedAt: new Date('2026-03-01'), changedByType: null, previousStatus: null, newStatus: 'active', reasonCode: null },
      ] as never);
      const result = await repo.findCustomerAuditEvents('t1', 'c1', baseQuery({ eventType: 'all' }));
      expect(models.operationalAuditLog.findAll).toHaveBeenCalled();
      expect(models.fraudCase.findAll).toHaveBeenCalled();
      // El evento más reciente (marzo) va primero.
      expect(result[0].occurredAt).toEqual(new Date('2026-03-01'));
      expect(result[1].occurredAt).toEqual(new Date('2026-01-01'));
    });

    it('limita la profundidad por fuente a MAX_DEPTH (1000)', async () => {
      const { repo, models } = buildRepo();
      await repo.findCustomerAuditEvents('t1', 'c1', baseQuery({ eventType: 'status', page: 100, limit: 100 }));
      expect(callArg<CallArgRecord>(models.customerStatusEvent.findAll, 0, 0).limit).toBe(1000);
    });
  });

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

  describe('encode/decode cursor', () => {
    it('round-trip base64url', () => {
      const key = { occurredAt: '2026-01-01T00:00:00Z', sourceTable: 'fraud_case_event', sourceId: '42' };
      expect(decodeAuditCursor(encodeAuditCursor(key))).toEqual(key);
    });

    it('decode devuelve null para undefined, basura o forma inválida', () => {
      expect(decodeAuditCursor(undefined)).toBeNull();
      expect(decodeAuditCursor('%%%no-base64%%%')).toBeNull();
      const partial = Buffer.from(JSON.stringify({ occurredAt: '2026' }), 'utf8').toString('base64url');
      expect(decodeAuditCursor(partial)).toBeNull();
    });
  });

  describe('feed "all" con filas incompletas (fallbacks de fecha y resumen)', () => {
    it('cae a createdAtValue y a los resúmenes por defecto cuando la fila no trae fecha ni nombre', async () => {
      const { repo, models } = buildRepo();
      const createdAtValue = new Date('2026-01-01T10:00:00.000Z');
      (models.customerStatusEvent.findAll as jest.Mock).mockResolvedValue([
        { id: 1, happenedAt: null, createdAtValue, previousStatus: null, newStatus: 'active' },
      ] as never);
      (models.customerActionLog.findAll as jest.Mock).mockResolvedValue([
        { id: 2, occurredAt: null, createdAtValue, eventName: null },
      ] as never);
      (models.authEvent.findAll as jest.Mock).mockResolvedValue([{ id: 3, occurredAt: null, createdAtValue, eventType: null }] as never);
      (models.dataChangeLog.findAll as jest.Mock).mockResolvedValue([{ id: 4, changedAt: null, createdAtValue }] as never);
      (models.operationalAuditLog.findAll as jest.Mock).mockResolvedValue([
        { id: 5, occurredAt: null, createdAtValue, actionCode: null },
      ] as never);
      // sin consentimientos: la consulta de eventos de consentimiento ni se dispara
      (models.customerConsent.findAll as jest.Mock).mockResolvedValue([] as never);

      const result = await repo.findCustomerAuditEvents('t1', 'c1', baseQuery({ eventType: 'all' }));
      const events = result;

      for (const event of events) expect(event.occurredAt).toEqual(createdAtValue);
      const summaries = events.map((event: { summary: string }) => event.summary);
      expect(summaries).toEqual(expect.arrayContaining(['Estado: none -> active', 'customer_action', 'auth_event', 'audit']));
      expect(models.consentEvent.findAll).not.toHaveBeenCalled();
    });
  });
});
