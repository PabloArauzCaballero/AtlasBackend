import { describe, expect, it, jest } from '@jest/globals';
import { PlatformCatalogFederationService } from '../../../src/modules/systems-ops/platform-catalog-federation.service.js';

describe('PlatformCatalogFederationService · columnas requeridas', () => {
  it('crea filas federadas con los valores que Sequelize exige antes de llegar a PostgreSQL', async () => {
    const manifest = {
      block: { code: 'DECISION_ENGINE', name: 'Motor QA' },
      endpoints: [
        {
          code: 'DECISION_ENGINE_QA_HEALTH',
          module: 'health',
          method: 'GET',
          fullPath: '/v1/health',
          requiresAuth: false,
          allowedRoles: [],
          isReadonly: true,
          isDestructive: false,
          riskLevel: 'LOW',
        },
      ],
      dataEntities: [
        {
          schemaName: 'public',
          tableName: 'qa_rules',
          entityName: 'qa_rules',
          module: 'qa_catalog',
          columnCount: 2,
          primaryKeyColumns: ['id'],
          containsPii: false,
          containsFinancialData: false,
          containsRiskData: true,
          isAuditCritical: true,
        },
      ],
    };
    const client = { fetchManifest: jest.fn(async () => ({ ok: true, manifest })) };
    const repository = {
      upsertEndpointRow: jest.fn(async (_structural: Record<string, unknown>, _insertOnly: Record<string, unknown>) => undefined),
      upsertDataEntityRow: jest.fn(async (_structural: Record<string, unknown>, _insertOnly: Record<string, unknown>) => undefined),
      deprecateMissingEndpoints: jest.fn(async () => 0),
      deprecateMissingDataEntities: jest.fn(async () => 0),
      recordOutcome: jest.fn(async () => undefined),
    };
    const service = new PlatformCatalogFederationService(client as never, repository as never);

    expect((await service.federateBlock('DECISION_ENGINE', 'qa-token')).status).toBe('OK');
    expect(repository.upsertEndpointRow.mock.calls[0]?.[1]).toMatchObject({ testEnvironmentOnly: false });
    expect(repository.upsertDataEntityRow.mock.calls[0]?.[1]).toMatchObject({
      whoUses: [],
      dataNature: 'OPERACIONAL',
      operationalRulesJson: [],
      qualityRulesJson: [],
    });
  });
});
