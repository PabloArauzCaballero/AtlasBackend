import { describe, expect, it, jest } from '@jest/globals';
import { ConsentsService } from '../../../src/modules/consents/consents.service.js';

/**
 * ATLAS-P12 (plan `PLAN_RED_DE_PRUEBAS_ATLAS_P12.md`, Fase 4): primer test real de `consents`
 * (254 líneas, 0 tests hasta este patch) — el más simple de los 11 módulos del plan: solo
 * lectura de catálogo de documentos de consentimiento activos.
 */
describe('ConsentsService.listActiveDocuments', () => {
  function buildService() {
    const repository = { findActiveDocuments: jest.fn() };
    const service = new ConsentsService(repository as never);
    return { service, repository };
  }

  it('delegates to the repository with the exact tenantId and query received', async () => {
    const { service, repository } = buildService();
    (repository.findActiveDocuments as jest.Mock).mockResolvedValueOnce([] as never);

    await service.listActiveDocuments('t1', { purposeCode: 'marketing' } as never);

    expect(repository.findActiveDocuments).toHaveBeenCalledWith('t1', { purposeCode: 'marketing' });
  });

  it('maps every document returned by the repository through the response mapper', async () => {
    const { service, repository } = buildService();
    (repository.findActiveDocuments as jest.Mock).mockResolvedValueOnce([
      { id: '1', documentCode: 'privacy_policy', version: '1.0' },
      { id: '2', documentCode: 'terms_of_service', version: '2.0' },
    ] as never);

    const result = await service.listActiveDocuments('t1', {} as never);

    expect(result).toHaveLength(2);
  });

  it('returns an empty array, not null or undefined, when there are no active documents', async () => {
    const { service, repository } = buildService();
    (repository.findActiveDocuments as jest.Mock).mockResolvedValueOnce([] as never);

    const result = await service.listActiveDocuments('t1', {} as never);

    expect(result).toEqual([]);
  });
});
