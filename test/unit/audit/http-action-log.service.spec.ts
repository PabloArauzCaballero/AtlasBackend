import { describe, expect, it, jest } from '@jest/globals';
import { HttpActionLogService } from '../../../src/modules/audit/http-action-log.service.js';

/**
 * `HttpActionLogService.createHttpAction` escribe en paralelo el log de auditoría operacional y el
 * log de acciones de systems-ops (con resolución de endpoint, hash de idempotencia y una batería de
 * valores por defecto). Spec directo con los 3 modelos mockeados; los sanitizadores/hashes reales.
 */
describe('HttpActionLogService', () => {
  function build() {
    const auditModel = { create: jest.fn(async () => ({ id: 'a1' })) };
    const systemActionLogModel = { create: jest.fn(async () => ({ id: 's1' })) };
    const endpointCatalogModel = { findOne: jest.fn(async () => null), findAll: jest.fn(async () => [] as unknown[]) };
    const service = new HttpActionLogService(auditModel as never, systemActionLogModel as never, endpointCatalogModel as never);
    return { service, auditModel, systemActionLogModel, endpointCatalogModel };
  }

  const baseInput = {
    tenantId: 't1',
    actorType: 'internal_user',
    actorInternalUserId: 'u1',
    actorPlatformUserId: null,
    actionCode: 'DO_THING',
    targetType: 'customer',
    targetId: 'c1',
    ipAddress: '1.1.1.1',
    userAgent: 'jest',
    payload: { customerId: 5, secret: 'x' },
    occurredAt: new Date('2026-01-01T00:00:00.000Z'),
  };

  const systemArgs = (m: { create: jest.Mock }) => (m.create.mock.calls[0] as [Record<string, unknown>])[0];

  it('createHttpAction escribe ambos logs y, sin método, no busca endpoint', async () => {
    const { service, auditModel, systemActionLogModel, endpointCatalogModel } = build();
    await service.createHttpAction(baseInput as never);
    expect(auditModel.create).toHaveBeenCalledTimes(1);
    expect(systemActionLogModel.create).toHaveBeenCalledTimes(1);
    expect(endpointCatalogModel.findOne).not.toHaveBeenCalled();
  });

  it('el log de auditoría copia actionCode y occurredAt (=createdAtValue) con payload redactado', async () => {
    const { service, auditModel } = build();
    await service.createHttpAction(baseInput as never);
    const args = (auditModel.create.mock.calls[0] as [Record<string, unknown>])[0];
    expect(args).toMatchObject({ actionCode: 'DO_THING', occurredAt: baseInput.occurredAt, createdAtValue: baseInput.occurredAt });
    expect(args.payloadJson).toBeDefined();
  });

  it('el log de systems-ops aplica los valores por defecto cuando faltan campos', async () => {
    const { service, systemActionLogModel } = build();
    await service.createHttpAction(baseInput as never);
    const args = systemArgs(systemActionLogModel as never);
    expect(args).toMatchObject({
      method: 'UNKNOWN',
      actorRole: 'internal_user', // ?? actorType
      actionName: 'DO_THING', // ?? actionCode
      riskLevel: 'LOW',
      containsPii: false,
      endpointCatalogId: null,
      customerId: '5', // payload.customerId -> String
    });
  });

  it('cuando el endpoint existe, hereda id/módulo/riesgo/pii del catálogo', async () => {
    const { service, systemActionLogModel, endpointCatalogModel } = build();
    (endpointCatalogModel.findOne as jest.Mock).mockResolvedValueOnce({
      id: 'e9',
      module: 'catalog',
      riskLevel: 'HIGH',
      containsPii: true,
      fullPath: '/api/v1/x',
    } as never);
    await service.createHttpAction({ ...baseInput, method: 'get', resolvedUrlSanitized: '/api/v1/x' } as never);
    expect(endpointCatalogModel.findOne).toHaveBeenCalledTimes(1);
    const args = systemArgs(systemActionLogModel as never);
    expect(args).toMatchObject({ endpointCatalogId: 'e9', module: 'catalog', riskLevel: 'HIGH', containsPii: true, method: 'get' });
  });

  it('hashea la llave de idempotencia solo cuando se provee', async () => {
    const withKey = build();
    await withKey.service.createHttpAction({ ...baseInput, idempotencyKey: 'idem-key-123' } as never);
    expect(systemArgs(withKey.systemActionLogModel as never).idempotencyKeyHash).toEqual(expect.any(String));

    const withoutKey = build();
    await withoutKey.service.createHttpAction(baseInput as never);
    expect(systemArgs(withoutKey.systemActionLogModel as never).idempotencyKeyHash).toBeNull();
  });
});
