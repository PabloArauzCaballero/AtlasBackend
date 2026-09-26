import { describe, expect, it, jest } from '@jest/globals';
import { ConsentsController } from '../../../src/modules/consents/consents.controller.js';
import { tenantIdFromHeader } from '../../../src/common/utils/http/headers.util.js';

/**
 * `ConsentsController` expone el listado público de documentos de consentimiento activos; parsea el
 * tenant del header y delega en `ConsentsService`. Spec directo con el servicio mockeado.
 */
describe('ConsentsController', () => {
  it('listActiveDocuments delega con el tenant parseado y la query', async () => {
    const service = { listActiveDocuments: jest.fn(async (..._args: unknown[]) => ({ items: [] })) };
    const controller = new ConsentsController(service as never);
    await controller.listActiveDocuments('1', { language: 'es' } as never);
    expect(service.listActiveDocuments).toHaveBeenCalledWith(tenantIdFromHeader('1'), { language: 'es' });
  });
});
