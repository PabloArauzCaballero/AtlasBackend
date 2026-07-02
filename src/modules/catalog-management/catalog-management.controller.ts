import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import { Roles } from '../../common/decorators/roles.decorator.js';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard.js';
import { RolesGuard } from '../../common/guards/roles.guard.js';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import { AuthenticatedUser } from '../../common/types/auth.types.js';
import { parsePositiveId } from '../../common/utils/ids/id.util.js';
import { CatalogManagementService } from './catalog-management.service.js';
import {
  ActivateRiskRulesetVersionDto,
  CatalogCodeParamsDto,
  CatalogDecisionDto,
  CatalogIngestionDto,
  CatalogVersionParamsDto,
  CreateCatalogVersionDto,
  CreateRiskRulesetVersionDto,
  DataGovernancePolicyPackageDto,
  DefinitionsPackageDto,
  DefinitionsQueryDto,
  ListCatalogsQueryDto,
  RulesetVersionParamsDto,
  StagingDecisionBatchDto,
  SubmitCatalogVersionDto,
  activateRiskRulesetVersionSchema,
  catalogCodeParamsSchema,
  catalogDecisionSchema,
  catalogIngestionSchema,
  catalogVersionParamsSchema,
  createCatalogVersionSchema,
  createRiskRulesetVersionSchema,
  dataGovernancePolicyPackageSchema,
  definitionsPackageSchema,
  definitionsQuerySchema,
  listCatalogsQuerySchema,
  rulesetVersionParamsSchema,
  stagingDecisionBatchSchema,
  submitCatalogVersionSchema,
} from './catalog-management.schemas.js';

type RequestWithNetwork = {
  ip?: string;
  headers: Record<string, string | string[] | undefined>;
};

type RequestContext = {
  tenantId: string;
  ipAddress: string | null;
  userAgent: string | null;
  idempotencyKey?: string;
};

function firstHeader(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

function contextFrom(tenantIdHeader: string | undefined, idempotencyKey: string | undefined, request: RequestWithNetwork): RequestContext {
  return {
    tenantId: parsePositiveId(String(tenantIdHeader ?? ''), 'x-tenant-id'),
    ipAddress: request.ip ?? null,
    userAgent: firstHeader(request.headers['user-agent']),
    idempotencyKey,
  };
}

function requireIdempotencyHeader(idempotencyKey: string | undefined): void {
  if (!idempotencyKey) throw new BadRequestException('X-Idempotency-Key header is required.');
}

@ApiTags('catalog-management')
@Controller('operations')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('internal_operator', 'risk_analyst', 'compliance_analyst', 'fraud_analyst', 'admin', 'platform_admin', 'system')
export class CatalogManagementController {
  constructor(private readonly service: CatalogManagementService) {}

  @Get('catalogs')
  listCatalogs(
    @Query(new ZodValidationPipe(listCatalogsQuerySchema)) query: ListCatalogsQueryDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    return this.service.listCatalogs({ query, currentUser });
  }

  @Get('catalogs/:catalogCode/versions/:versionId')
  getCatalogVersion(
    @Param(new ZodValidationPipe(catalogVersionParamsSchema)) params: CatalogVersionParamsDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    return this.service.getCatalogVersion({ catalogCode: params.catalogCode, versionId: params.versionId, currentUser });
  }

  @Post('catalogs/:catalogCode/versions')
  @HttpCode(HttpStatus.CREATED)
  createCatalogVersion(
    @Headers('x-tenant-id') tenantIdHeader: string | undefined,
    @Headers('x-idempotency-key') idempotencyKey: string | undefined,
    @Param(new ZodValidationPipe(catalogCodeParamsSchema)) params: CatalogCodeParamsDto,
    @Body(new ZodValidationPipe(createCatalogVersionSchema)) body: CreateCatalogVersionDto,
    @CurrentUser() currentUser: AuthenticatedUser,
    @Req() request: RequestWithNetwork,
  ) {
    requireIdempotencyHeader(idempotencyKey);
    return this.service.createCatalogVersion({
      catalogCode: params.catalogCode,
      body,
      currentUser,
      context: contextFrom(tenantIdHeader, idempotencyKey, request),
    });
  }

  @Post('catalogs/:catalogCode/versions/:versionId/submit-for-approval')
  @HttpCode(HttpStatus.OK)
  submitCatalogVersion(
    @Headers('x-tenant-id') tenantIdHeader: string | undefined,
    @Headers('x-idempotency-key') idempotencyKey: string | undefined,
    @Param(new ZodValidationPipe(catalogVersionParamsSchema)) params: CatalogVersionParamsDto,
    @Body(new ZodValidationPipe(submitCatalogVersionSchema)) body: SubmitCatalogVersionDto,
    @CurrentUser() currentUser: AuthenticatedUser,
    @Req() request: RequestWithNetwork,
  ) {
    requireIdempotencyHeader(idempotencyKey);
    return this.service.submitCatalogVersion({
      catalogCode: params.catalogCode,
      versionId: params.versionId,
      body,
      currentUser,
      context: contextFrom(tenantIdHeader, idempotencyKey, request),
    });
  }

  @Post('catalogs/:catalogCode/versions/:versionId/decision')
  @HttpCode(HttpStatus.OK)
  decideCatalogVersion(
    @Headers('x-tenant-id') tenantIdHeader: string | undefined,
    @Headers('x-idempotency-key') idempotencyKey: string | undefined,
    @Param(new ZodValidationPipe(catalogVersionParamsSchema)) params: CatalogVersionParamsDto,
    @Body(new ZodValidationPipe(catalogDecisionSchema)) body: CatalogDecisionDto,
    @CurrentUser() currentUser: AuthenticatedUser,
    @Req() request: RequestWithNetwork,
  ) {
    requireIdempotencyHeader(idempotencyKey);
    return this.service.decideCatalogVersion({
      catalogCode: params.catalogCode,
      versionId: params.versionId,
      body,
      currentUser,
      context: contextFrom(tenantIdHeader, idempotencyKey, request),
    });
  }

  @Post('catalog-ingestions')
  @HttpCode(HttpStatus.CREATED)
  ingestCatalog(
    @Headers('x-tenant-id') tenantIdHeader: string | undefined,
    @Headers('x-idempotency-key') idempotencyKey: string | undefined,
    @Body(new ZodValidationPipe(catalogIngestionSchema)) body: CatalogIngestionDto,
    @CurrentUser() currentUser: AuthenticatedUser,
    @Req() request: RequestWithNetwork,
  ) {
    requireIdempotencyHeader(idempotencyKey);
    return this.service.ingestCatalog({ body, currentUser, context: contextFrom(tenantIdHeader, idempotencyKey, request) });
  }

  @Post('catalog-staging-items/decision-batch')
  @HttpCode(HttpStatus.OK)
  decideStagingItems(
    @Headers('x-tenant-id') tenantIdHeader: string | undefined,
    @Headers('x-idempotency-key') idempotencyKey: string | undefined,
    @Body(new ZodValidationPipe(stagingDecisionBatchSchema)) body: StagingDecisionBatchDto,
    @CurrentUser() currentUser: AuthenticatedUser,
    @Req() request: RequestWithNetwork,
  ) {
    requireIdempotencyHeader(idempotencyKey);
    return this.service.decideStagingItems({ body, currentUser, context: contextFrom(tenantIdHeader, idempotencyKey, request) });
  }

  @Get('definitions')
  listDefinitions(
    @Query(new ZodValidationPipe(definitionsQuerySchema)) query: DefinitionsQueryDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    return this.service.listDefinitions({ query, currentUser });
  }

  @Post('definitions/package')
  @HttpCode(HttpStatus.OK)
  upsertDefinitionsPackage(
    @Headers('x-tenant-id') tenantIdHeader: string | undefined,
    @Headers('x-idempotency-key') idempotencyKey: string | undefined,
    @Body(new ZodValidationPipe(definitionsPackageSchema)) body: DefinitionsPackageDto,
    @CurrentUser() currentUser: AuthenticatedUser,
    @Req() request: RequestWithNetwork,
  ) {
    requireIdempotencyHeader(idempotencyKey);
    return this.service.upsertDefinitionsPackage({ body, currentUser, context: contextFrom(tenantIdHeader, idempotencyKey, request) });
  }

  @Get('risk-policy/current')
  getCurrentRiskPolicy(@CurrentUser() currentUser: AuthenticatedUser) {
    return this.service.getCurrentRiskPolicy({ currentUser });
  }

  @Post('risk-policy/ruleset-versions')
  @HttpCode(HttpStatus.CREATED)
  createRiskRulesetVersion(
    @Headers('x-tenant-id') tenantIdHeader: string | undefined,
    @Headers('x-idempotency-key') idempotencyKey: string | undefined,
    @Body(new ZodValidationPipe(createRiskRulesetVersionSchema)) body: CreateRiskRulesetVersionDto,
    @CurrentUser() currentUser: AuthenticatedUser,
    @Req() request: RequestWithNetwork,
  ) {
    requireIdempotencyHeader(idempotencyKey);
    return this.service.createRiskRulesetVersion({ body, currentUser, context: contextFrom(tenantIdHeader, idempotencyKey, request) });
  }

  @Post('risk-policy/ruleset-versions/:rulesetVersionId/activate')
  @HttpCode(HttpStatus.OK)
  activateRiskRulesetVersion(
    @Headers('x-tenant-id') tenantIdHeader: string | undefined,
    @Headers('x-idempotency-key') idempotencyKey: string | undefined,
    @Param(new ZodValidationPipe(rulesetVersionParamsSchema)) params: RulesetVersionParamsDto,
    @Body(new ZodValidationPipe(activateRiskRulesetVersionSchema)) body: ActivateRiskRulesetVersionDto,
    @CurrentUser() currentUser: AuthenticatedUser,
    @Req() request: RequestWithNetwork,
  ) {
    requireIdempotencyHeader(idempotencyKey);
    return this.service.activateRiskRulesetVersion({
      rulesetVersionId: params.rulesetVersionId,
      body,
      currentUser,
      context: contextFrom(tenantIdHeader, idempotencyKey, request),
    });
  }

  @Get('data-governance/policies')
  getDataGovernancePolicies(@CurrentUser() currentUser: AuthenticatedUser) {
    return this.service.getDataGovernancePolicies({ currentUser });
  }

  @Post('data-governance/policy-package')
  @HttpCode(HttpStatus.OK)
  upsertDataGovernancePackage(
    @Headers('x-tenant-id') tenantIdHeader: string | undefined,
    @Headers('x-idempotency-key') idempotencyKey: string | undefined,
    @Body(new ZodValidationPipe(dataGovernancePolicyPackageSchema)) body: DataGovernancePolicyPackageDto,
    @CurrentUser() currentUser: AuthenticatedUser,
    @Req() request: RequestWithNetwork,
  ) {
    requireIdempotencyHeader(idempotencyKey);
    return this.service.upsertDataGovernancePackage({ body, currentUser, context: contextFrom(tenantIdHeader, idempotencyKey, request) });
  }
}
