import { describe, expect, it, jest } from '@jest/globals';
import { SystemsDataImpactInferenceRepository } from '../../../src/modules/systems-ops/systems-data-impact-inference.repository.js';

/**
 * Cobertura directa de `SystemsDataImpactInferenceRepository` (Fase 1.2 del plan 10/10): listados de
 * catálogo y el upsert de impacto endpoint↔entidad, que deriva múltiples flags a partir de los
 * atributos de la entidad y del tipo de operación. Modelos Sequelize mockeados.
 */
describe('SystemsDataImpactInferenceRepository', () => {
  function buildRepo() {
    const endpointModel = { findAll: jest.fn() };
    const dataEntityModel = { findAll: jest.fn() };
    const impactModel = { upsert: jest.fn() };
    const relationshipModel = { findAll: jest.fn() };
    const repo = new SystemsDataImpactInferenceRepository(endpointModel as never, dataEntityModel as never, impactModel as never, relationshipModel as never);
    return { repo, endpointModel, dataEntityModel, impactModel, relationshipModel };
  }

  it('listActiveEndpoints filtra por status ACTIVE', async () => {
    const { repo, endpointModel } = buildRepo();
    (endpointModel.findAll as jest.Mock).mockResolvedValue([] as never);
    await repo.listActiveEndpoints();
    expect((endpointModel.findAll as jest.Mock).mock.calls[0][0].where).toEqual({ status: 'ACTIVE' });
  });

  it('listRelationships ordena por sourceTable', async () => {
    const { repo, relationshipModel } = buildRepo();
    (relationshipModel.findAll as jest.Mock).mockResolvedValue([] as never);
    await repo.listRelationships();
    expect((relationshipModel.findAll as jest.Mock).mock.calls[0][0].order).toEqual([['sourceTable', 'ASC']]);
  });

  it('upsertImpact para UPSERT sobre entidad audit-critical deriva impactLevel HIGH y flags transaccionales', async () => {
    const { repo, impactModel } = buildRepo();
    (impactModel.upsert as jest.Mock).mockResolvedValue([{ id: 'imp1' }] as never);
    const endpoint = { id: 10 } as never;
    const entity = {
      id: 20,
      isAuditCritical: true,
      module: 'customers',
      containsFinancialData: true,
      containsRiskData: false,
      containsLegalData: false,
      containsDeviceData: false,
    } as never;
    await repo.upsertImpact(endpoint, entity, { operationType: 'UPSERT', confidenceLevel: 'HIGH', notes: 'n' });
    expect((impactModel.upsert as jest.Mock).mock.calls[0][0]).toMatchObject({
      endpointId: '10',
      dataEntityId: '20',
      impactLevel: 'HIGH',
      isTransactional: true,
      requiresRegressionTest: true,
      requiresStressTest: true,
      affectsCustomerState: true,
      affectsFinancialState: true,
      reviewStatus: 'NEEDS_REVIEW',
      detectedFrom: 'source_inference',
    });
  });

  it('upsertImpact para READ sobre entidad no crítica deriva impactLevel MEDIUM y no transaccional', async () => {
    const { repo, impactModel } = buildRepo();
    (impactModel.upsert as jest.Mock).mockResolvedValue([{ id: 'imp2' }] as never);
    const endpoint = { id: 1 } as never;
    const entity = {
      id: 2,
      isAuditCritical: false,
      module: 'systems',
      containsFinancialData: false,
      containsRiskData: false,
      containsLegalData: false,
      containsDeviceData: false,
    } as never;
    await repo.upsertImpact(endpoint, entity, { operationType: 'READ', confidenceLevel: 'LOW', notes: 'n', detectedFrom: 'manual' });
    expect((impactModel.upsert as jest.Mock).mock.calls[0][0]).toMatchObject({
      impactLevel: 'MEDIUM',
      isTransactional: false,
      requiresRegressionTest: false,
      requiresStressTest: false,
      affectsCustomerState: false,
      requiresAuditLog: false,
      detectedFrom: 'manual',
    });
  });
});
