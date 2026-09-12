import { describe, expect, it, jest } from '@jest/globals';
import { CatalogManagementService } from '../../../src/modules/catalog-management/catalog-management.service.js';

/**
 * `CatalogManagementService` es una fachada: cada operación delega en su sub-servicio de aplicación
 * (query / version-workflow / ingestion / definitions / risk-policy / data-governance). Spec directo
 * que verifica el ruteo de las 15 operaciones.
 */
describe('CatalogManagementService (fachada)', () => {
  function build() {
    const queryService = {
      listCatalogs: jest.fn(async (..._args: unknown[]) => 'lc'),
      getCatalogVersion: jest.fn(async (..._args: unknown[]) => 'gcv'),
    };
    const versionWorkflowService = {
      createCatalogVersion: jest.fn(async (..._args: unknown[]) => 'ccv'),
      submitCatalogVersion: jest.fn(async (..._args: unknown[]) => 'scv'),
      decideCatalogVersion: jest.fn(async (..._args: unknown[]) => 'dcv'),
    };
    const ingestionService = {
      ingestCatalog: jest.fn(async (..._args: unknown[]) => 'ic'),
      decideStagingItems: jest.fn(async (..._args: unknown[]) => 'dsi'),
    };
    const definitionsService = {
      listDefinitions: jest.fn(async (..._args: unknown[]) => 'ld'),
      upsertDefinitionsPackage: jest.fn(async (..._args: unknown[]) => 'udp'),
    };
    const riskPolicyService = {
      getCurrentRiskPolicy: jest.fn(async (..._args: unknown[]) => 'gcrp'),
      createRiskRulesetVersion: jest.fn(async (..._args: unknown[]) => 'crrv'),
      activateRiskRulesetVersion: jest.fn(async (..._args: unknown[]) => 'arrv'),
    };
    const dataGovernanceService = {
      getDataGovernancePolicies: jest.fn(async (..._args: unknown[]) => 'gdgp'),
      upsertDataGovernancePackage: jest.fn(async (..._args: unknown[]) => 'udgp'),
    };
    const service = new CatalogManagementService(
      queryService as never,
      versionWorkflowService as never,
      ingestionService as never,
      definitionsService as never,
      riskPolicyService as never,
      dataGovernanceService as never,
    );
    return {
      service,
      queryService,
      versionWorkflowService,
      ingestionService,
      definitionsService,
      riskPolicyService,
      dataGovernanceService,
    };
  }

  it('delega cada operación en su sub-servicio de aplicación', async () => {
    const b = build();
    const input = { currentUser: {}, context: {}, body: {}, query: {}, catalogCode: 'C', versionId: 'v', rulesetVersionId: 'r' } as never;

    expect(await b.service.listCatalogs(input)).toBe('lc');
    expect(b.queryService.listCatalogs).toHaveBeenCalledWith(input);
    await b.service.getCatalogVersion(input);
    expect(b.queryService.getCatalogVersion).toHaveBeenCalledWith(input);

    await b.service.createCatalogVersion(input);
    await b.service.submitCatalogVersion(input);
    await b.service.decideCatalogVersion(input);
    expect(b.versionWorkflowService.createCatalogVersion).toHaveBeenCalledWith(input);
    expect(b.versionWorkflowService.submitCatalogVersion).toHaveBeenCalledWith(input);
    expect(b.versionWorkflowService.decideCatalogVersion).toHaveBeenCalledWith(input);

    await b.service.ingestCatalog(input);
    await b.service.decideStagingItems(input);
    expect(b.ingestionService.ingestCatalog).toHaveBeenCalledWith(input);
    expect(b.ingestionService.decideStagingItems).toHaveBeenCalledWith(input);

    await b.service.listDefinitions(input);
    await b.service.upsertDefinitionsPackage(input);
    expect(b.definitionsService.listDefinitions).toHaveBeenCalledWith(input);
    expect(b.definitionsService.upsertDefinitionsPackage).toHaveBeenCalledWith(input);

    await b.service.getCurrentRiskPolicy(input);
    await b.service.createRiskRulesetVersion(input);
    await b.service.activateRiskRulesetVersion(input);
    expect(b.riskPolicyService.getCurrentRiskPolicy).toHaveBeenCalledWith(input);
    expect(b.riskPolicyService.createRiskRulesetVersion).toHaveBeenCalledWith(input);
    expect(b.riskPolicyService.activateRiskRulesetVersion).toHaveBeenCalledWith(input);

    await b.service.getDataGovernancePolicies(input);
    await b.service.upsertDataGovernancePackage(input);
    expect(b.dataGovernanceService.getDataGovernancePolicies).toHaveBeenCalledWith(input);
    expect(b.dataGovernanceService.upsertDataGovernancePackage).toHaveBeenCalledWith(input);
  });
});
