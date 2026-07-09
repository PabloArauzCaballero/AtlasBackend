import { Injectable } from '@nestjs/common';
import { AuthenticatedUser } from '../../common/types/auth.types.js';
import { CatalogDataGovernanceService } from './application/catalog-data-governance.service.js';
import { CatalogDefinitionsService } from './application/catalog-definitions.service.js';
import { CatalogIngestionService } from './application/catalog-ingestion.service.js';
import { CatalogQueryService } from './application/catalog-query.service.js';
import { CatalogRiskPolicyService } from './application/catalog-risk-policy.service.js';
import { RequestContext } from './application/catalog-management.shared.js';
import { CatalogVersionWorkflowService } from './application/catalog-version-workflow.service.js';
import {
  ActivateRiskRulesetVersionDto,
  CatalogDecisionDto,
  CatalogIngestionDto,
  CreateCatalogVersionDto,
  CreateRiskRulesetVersionDto,
  DataGovernancePolicyPackageDto,
  DefinitionsPackageDto,
  DefinitionsQueryDto,
  ListCatalogsQueryDto,
  StagingDecisionBatchDto,
  SubmitCatalogVersionDto,
} from './catalog-management.schemas.js';

@Injectable()
export class CatalogManagementService {
  constructor(
    private readonly queryService: CatalogQueryService,
    private readonly versionWorkflowService: CatalogVersionWorkflowService,
    private readonly ingestionService: CatalogIngestionService,
    private readonly definitionsService: CatalogDefinitionsService,
    private readonly riskPolicyService: CatalogRiskPolicyService,
    private readonly dataGovernanceService: CatalogDataGovernanceService,
  ) {}

  listCatalogs(input: { query: ListCatalogsQueryDto; currentUser: AuthenticatedUser }) {
    return this.queryService.listCatalogs(input);
  }

  getCatalogVersion(input: { catalogCode: string; versionId: string; currentUser: AuthenticatedUser }) {
    return this.queryService.getCatalogVersion(input);
  }

  createCatalogVersion(input: {
    catalogCode: string;
    body: CreateCatalogVersionDto;
    currentUser: AuthenticatedUser;
    context: RequestContext;
  }) {
    return this.versionWorkflowService.createCatalogVersion(input);
  }

  submitCatalogVersion(input: {
    catalogCode: string;
    versionId: string;
    body: SubmitCatalogVersionDto;
    currentUser: AuthenticatedUser;
    context: RequestContext;
  }) {
    return this.versionWorkflowService.submitCatalogVersion(input);
  }

  decideCatalogVersion(input: {
    catalogCode: string;
    versionId: string;
    body: CatalogDecisionDto;
    currentUser: AuthenticatedUser;
    context: RequestContext;
  }) {
    return this.versionWorkflowService.decideCatalogVersion(input);
  }

  ingestCatalog(input: { body: CatalogIngestionDto; currentUser: AuthenticatedUser; context: RequestContext }) {
    return this.ingestionService.ingestCatalog(input);
  }

  decideStagingItems(input: { body: StagingDecisionBatchDto; currentUser: AuthenticatedUser; context: RequestContext }) {
    return this.ingestionService.decideStagingItems(input);
  }

  listDefinitions(input: { query: DefinitionsQueryDto; currentUser: AuthenticatedUser }) {
    return this.definitionsService.listDefinitions(input);
  }

  upsertDefinitionsPackage(input: { body: DefinitionsPackageDto; currentUser: AuthenticatedUser; context: RequestContext }) {
    return this.definitionsService.upsertDefinitionsPackage(input);
  }

  getCurrentRiskPolicy(input: { currentUser: AuthenticatedUser }) {
    return this.riskPolicyService.getCurrentRiskPolicy(input);
  }

  createRiskRulesetVersion(input: { body: CreateRiskRulesetVersionDto; currentUser: AuthenticatedUser; context: RequestContext }) {
    return this.riskPolicyService.createRiskRulesetVersion(input);
  }

  activateRiskRulesetVersion(input: {
    rulesetVersionId: string;
    body: ActivateRiskRulesetVersionDto;
    currentUser: AuthenticatedUser;
    context: RequestContext;
  }) {
    return this.riskPolicyService.activateRiskRulesetVersion(input);
  }

  getDataGovernancePolicies(input: { currentUser: AuthenticatedUser }) {
    return this.dataGovernanceService.getDataGovernancePolicies(input);
  }

  upsertDataGovernancePackage(input: { body: DataGovernancePolicyPackageDto; currentUser: AuthenticatedUser; context: RequestContext }) {
    return this.dataGovernanceService.upsertDataGovernancePackage(input);
  }
}
