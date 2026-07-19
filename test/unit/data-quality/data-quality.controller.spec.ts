import { describe, expect, it, jest } from '@jest/globals';
import { BadRequestException } from '@nestjs/common';
import { DataQualityController } from '../../../src/modules/data-quality/data-quality.controller.js';
import { tenantIdFromHeader } from '../../../src/common/utils/http/headers.util.js';

/**
 * `DataQualityController` lista/resuelve issues de calidad de datos. La rama propia interesante es la
 * exigencia del header `x-idempotency-key` en resolveIssue. Spec directo con el servicio mockeado.
 */
describe('DataQualityController', () => {
  function build() {
    const service = { listIssues: jest.fn(async () => ({ items: [] })), resolveIssue: jest.fn(async () => ({ resolved: true })) };
    return { controller: new DataQualityController(service as never), service };
  }
  const params = { issueId: '7' } as never;
  const body = { resolution: 'RESOLVED', notes: 'ok' } as never;
  const currentUser = { tenantId: '1', internalUserId: 'u1' } as never;

  it('listIssues delega con el tenant parseado y la query', async () => {
    const { controller, service } = build();
    await controller.listIssues('1', { status: 'OPEN' } as never);
    expect(service.listIssues).toHaveBeenCalledWith(tenantIdFromHeader('1'), { status: 'OPEN' });
  });

  it('resolveIssue exige el header x-idempotency-key', () => {
    const { controller, service } = build();
    expect(() => controller.resolveIssue('1', undefined, params, body, currentUser)).toThrow(BadRequestException);
    expect(service.resolveIssue).not.toHaveBeenCalled();
  });

  it('resolveIssue delega con el input estructurado cuando hay idempotency-key', async () => {
    const { controller, service } = build();
    await controller.resolveIssue('1', 'idem-key', params, body, currentUser);
    expect(service.resolveIssue).toHaveBeenCalledWith({
      tenantId: tenantIdFromHeader('1'),
      params,
      body,
      currentUser,
      idempotencyKey: 'idem-key',
    });
  });
});
