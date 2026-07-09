import { describe, expect, it, jest } from '@jest/globals';
import { AuditRepository } from '../../../src/modules/audit/audit.repository.js';

/**
 * ATLAS-AUDIT (auditoría #14, `audit`): `consent`, `manual_review` y `fraud` estaban en el enum
 * de `eventType` del schema pero no tenían ninguna rama de consulta en
 * `findCustomerAuditEvents` — pedir cualquiera de esos 3 filtros devolvía `[]` siempre, en
 * silencio, y `eventType=all` nunca los incluía. Este test cubre las 3 ramas agregadas por el
 * fix, sin base de datos real (todos los modelos inyectados están mockeados).
 */
describe('AuditRepository.findCustomerAuditEvents — consent/manual_review/fraud branches', () => {
  function buildRepository(overrides: Record<string, unknown> = {}) {
    const models = {
      operationalAuditLogModel: { findAll: jest.fn(async () => []) },
      dataChangeLogModel: { findAll: jest.fn(async () => []) },
      customerStatusEventModel: { findAll: jest.fn(async () => []) },
      customerActionLogModel: { findAll: jest.fn(async () => []) },
      authEventModel: { findAll: jest.fn(async () => []) },
      consentEventModel: { findAll: jest.fn(async () => []) },
      manualReviewEventModel: { findAll: jest.fn(async () => []) },
      fraudCaseEventModel: { findAll: jest.fn(async () => []) },
      customerConsentModel: { findAll: jest.fn(async () => []) },
      manualReviewCaseModel: { findAll: jest.fn(async () => []) },
      fraudCaseModel: { findAll: jest.fn(async () => []) },
      ...overrides,
    };
    const repository = new AuditRepository(
      models.operationalAuditLogModel as never,
      models.dataChangeLogModel as never,
      models.customerStatusEventModel as never,
      models.customerActionLogModel as never,
      models.authEventModel as never,
      models.consentEventModel as never,
      models.manualReviewEventModel as never,
      models.fraudCaseEventModel as never,
      models.customerConsentModel as never,
      models.manualReviewCaseModel as never,
      models.fraudCaseModel as never,
      {} as never,
    );
    return { repository, models };
  }

  const baseQuery = { page: 1, limit: 50 } as never;

  it('eventType=consent resolves customer_consents ids first, then queries consent_events by those ids', async () => {
    const { repository, models } = buildRepository({
      customerConsentModel: { findAll: jest.fn(async () => [{ id: 'cc-1' }, { id: 'cc-2' }]) },
      consentEventModel: {
        findAll: jest.fn(async () => [
          { happenedAt: new Date('2026-01-01T00:00:00.000Z'), createdAtValue: new Date(), triggeredByType: 'customer', eventType: 'granted', notes: null },
        ]),
      },
    });

    const result = await repository.findCustomerAuditEvents('t1', 'c1', { ...baseQuery, eventType: 'consent' });

    expect(models.customerConsentModel.findAll).toHaveBeenCalledWith(expect.objectContaining({ where: { tenantId: 't1', customerId: 'c1' } }));
    expect(models.consentEventModel.findAll).toHaveBeenCalledTimes(1);
    expect(result).toHaveLength(1);
    expect(result[0]?.eventType).toBe('consent');
  });

  it('eventType=consent returns [] without querying consent_events when the customer has no consents at all', async () => {
    const { repository, models } = buildRepository({
      customerConsentModel: { findAll: jest.fn(async () => []) },
    });

    const result = await repository.findCustomerAuditEvents('t1', 'c1', { ...baseQuery, eventType: 'consent' });

    expect(models.consentEventModel.findAll).not.toHaveBeenCalled();
    expect(result).toEqual([]);
  });

  it('eventType=manual_review resolves manual_review_cases ids first, then queries manual_review_events', async () => {
    const { repository, models } = buildRepository({
      manualReviewCaseModel: { findAll: jest.fn(async () => [{ id: 'case-1' }]) },
      manualReviewEventModel: {
        findAll: jest.fn(async () => [
          { happenedAt: new Date('2026-01-01T00:00:00.000Z'), createdAtValue: new Date(), actorType: 'risk_analyst', eventType: 'decision_recorded', payloadJson: {} },
        ]),
      },
    });

    const result = await repository.findCustomerAuditEvents('t1', 'c1', { ...baseQuery, eventType: 'manual_review' });

    expect(models.manualReviewEventModel.findAll).toHaveBeenCalledTimes(1);
    expect(result[0]?.eventType).toBe('manual_review');
  });

  it('eventType=fraud resolves fraud_cases ids first, then queries fraud_case_events', async () => {
    const { repository, models } = buildRepository({
      fraudCaseModel: { findAll: jest.fn(async () => [{ id: 'fraud-1' }]) },
      fraudCaseEventModel: {
        findAll: jest.fn(async () => [
          { happenedAt: new Date('2026-01-01T00:00:00.000Z'), createdAtValue: new Date(), actorType: 'fraud_analyst', eventType: 'decision_recorded', payloadJson: {} },
        ]),
      },
    });

    const result = await repository.findCustomerAuditEvents('t1', 'c1', { ...baseQuery, eventType: 'fraud' });

    expect(models.fraudCaseEventModel.findAll).toHaveBeenCalledTimes(1);
    expect(result[0]?.eventType).toBe('fraud');
  });

  it('eventType=all merges consent/manual_review/fraud together with the pre-existing 5 sources', async () => {
    const { repository, models } = buildRepository({
      customerConsentModel: { findAll: jest.fn(async () => [{ id: 'cc-1' }]) },
      consentEventModel: {
        findAll: jest.fn(async () => [
          { happenedAt: new Date('2026-01-03T00:00:00.000Z'), createdAtValue: new Date(), triggeredByType: 'customer', eventType: 'granted', notes: null },
        ]),
      },
      manualReviewCaseModel: { findAll: jest.fn(async () => [{ id: 'case-1' }]) },
      manualReviewEventModel: {
        findAll: jest.fn(async () => [
          { happenedAt: new Date('2026-01-02T00:00:00.000Z'), createdAtValue: new Date(), actorType: 'risk_analyst', eventType: 'decision_recorded', payloadJson: {} },
        ]),
      },
      fraudCaseModel: { findAll: jest.fn(async () => [{ id: 'fraud-1' }]) },
      fraudCaseEventModel: {
        findAll: jest.fn(async () => [
          { happenedAt: new Date('2026-01-01T00:00:00.000Z'), createdAtValue: new Date(), actorType: 'fraud_analyst', eventType: 'decision_recorded', payloadJson: {} },
        ]),
      },
    });

    const result = await repository.findCustomerAuditEvents('t1', 'c1', { ...baseQuery, eventType: 'all' });

    const eventTypes = result.map((event) => event.eventType);
    expect(eventTypes).toEqual(expect.arrayContaining(['consent', 'manual_review', 'fraud']));
    expect(models.operationalAuditLogModel.findAll).toHaveBeenCalledTimes(1);
  });
});
