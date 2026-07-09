import { Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { InjectConnection } from '@nestjs/sequelize';
import { Sequelize } from 'sequelize-typescript';
import { AuthenticatedUser } from '../../../common/types/auth.types.js';
import { riskPolicyDto } from '../catalog-management.mapper.js';
import { CatalogManagementRepository } from '../catalog-management.repository.js';
import { ActivateRiskRulesetVersionDto, CreateRiskRulesetVersionDto } from '../catalog-management.schemas.js';
import { actorPlatformUserId, assertInternal, auditBase, RequestContext, requireIdempotency } from './catalog-management.shared.js';

@Injectable()
export class CatalogRiskPolicyService {
  constructor(
    private readonly repository: CatalogManagementRepository,
    @InjectConnection() private readonly sequelize: Sequelize,
  ) {}

  async getCurrentRiskPolicy(input: { currentUser: AuthenticatedUser }) {
    assertInternal(input.currentUser);
    const current = await this.repository.listCurrentRiskPolicy();
    const rules = await this.repository.findRulesByRulesetIds(current.rulesetVersions.map((ruleset) => String(ruleset.id)));
    return riskPolicyDto({ ...current, rules });
  }

  async createRiskRulesetVersion(input: { body: CreateRiskRulesetVersionDto; currentUser: AuthenticatedUser; context: RequestContext }) {
    assertInternal(input.currentUser);
    requireIdempotency(input.context);
    const now = new Date();
    return this.sequelize.transaction(async (transaction) => {
      const modelVersion = await this.repository.createRiskModelVersion(
        {
          modelCode: input.body.modelVersion.modelCode,
          versionCode: input.body.modelVersion.versionCode,
          modelType: input.body.modelVersion.modelType,
          assessmentType: input.body.modelVersion.assessmentType,
          status: input.body.modelVersion.status,
          effectiveFrom: null,
          effectiveUntil: null,
          approvedByPlatformUserId: null,
          approvedAt: null,
          artifactUrl: input.body.modelVersion.artifactUrl ?? null,
          artifactHash: input.body.modelVersion.artifactHash ?? null,
          createdAtValue: now,
        },
        { transaction },
      );
      const ruleset = await this.repository.createRiskRulesetVersion(
        {
          rulesetCode: input.body.ruleset.rulesetCode,
          versionCode: input.body.ruleset.versionCode,
          assessmentType: input.body.ruleset.assessmentType,
          status: input.body.ruleset.status,
          effectiveFrom: null,
          effectiveUntil: null,
          approvedByPlatformUserId: null,
          approvedAt: null,
          createdAtValue: now,
        },
        { transaction },
      );
      for (const rule of input.body.rules) {
        await this.repository.createRiskPolicyRule(
          {
            rulesetVersionId: String(ruleset.id),
            ruleCode: rule.ruleCode,
            ruleName: rule.ruleName,
            riskDimension: rule.riskDimension,
            ruleType: rule.ruleType,
            severity: rule.severity,
            expressionJson: rule.expressionJson,
            actionCode: rule.actionCode,
            reasonCode: rule.reasonCode,
            isHardStop: rule.isHardStop,
            createdAtValue: now,
          },
          { transaction },
        );
      }
      for (const seed of input.body.riskSignalSeeds) {
        await this.repository.createRiskSignalSeed(
          {
            signalCode: seed.signalCode,
            signalName: seed.signalName,
            signalType: seed.signalType,
            sourceEntity: seed.sourceEntity,
            targetDefinitionCode: seed.targetDefinitionCode ?? null,
            riskDimension: seed.riskDimension ?? null,
            buildPhase: seed.buildPhase ?? null,
            priority: seed.priority ?? null,
            expectedDirection: seed.expectedDirection ?? null,
            exampleValueJson: seed.exampleValue,
            rationale: seed.rationale ?? null,
            isActive: true,
            createdAtValue: now,
            updatedAtValue: now,
          },
          { transaction },
        );
      }
      await this.repository.createAudit(
        {
          ...auditBase(input.context, input.currentUser),
          actionCode: 'risk_policy.ruleset_version.create',
          targetType: 'risk_ruleset_version',
          targetId: String(ruleset.id),
          payload: {
            modelVersionId: String(modelVersion.id),
            rulesCreated: input.body.rules.length,
            seedsCreated: input.body.riskSignalSeeds.length,
          },
          occurredAt: now,
        },
        { transaction },
      );
      await this.repository.createDataChange(
        {
          tenantId: input.context.tenantId,
          tableName: 'risk_ruleset_versions',
          recordId: String(ruleset.id),
          changeType: 'create',
          actorType: input.currentUser.role,
          actorInternalUserId: input.currentUser.internalUserId ?? null,
          actorPlatformUserId: actorPlatformUserId(input.currentUser),
          reason: 'Nueva versión de reglas de riesgo creada.',
          newValues: { rulesetCode: ruleset.rulesetCode, versionCode: ruleset.versionCode, rulesCreated: input.body.rules.length },
          happenedAt: now,
        },
        { transaction },
      );
      return {
        riskModelVersionId: String(modelVersion.id),
        riskRulesetVersionId: String(ruleset.id),
        status: ruleset.status,
        rulesCreated: input.body.rules.length,
        riskSignalSeedsCreated: input.body.riskSignalSeeds.length,
      };
    });
  }

  async activateRiskRulesetVersion(input: {
    rulesetVersionId: string;
    body: ActivateRiskRulesetVersionDto;
    currentUser: AuthenticatedUser;
    context: RequestContext;
  }) {
    assertInternal(input.currentUser);
    requireIdempotency(input.context);
    const version = await this.repository.findRiskRulesetVersionById(input.rulesetVersionId);
    if (!version) throw new NotFoundException('Versión de reglas no encontrada.');
    if (!['draft', 'inactive', 'approved'].includes(version.status ?? ''))
      throw new UnprocessableEntityException('RULESET_VERSION_NOT_ACTIVATABLE');
    const now = new Date();
    const effectiveFrom = input.body.effectiveFrom ? new Date(input.body.effectiveFrom) : now;
    return this.sequelize.transaction(async (transaction) => {
      const retiredCount = await this.repository.retireOtherActiveRulesets(version.rulesetCode, input.rulesetVersionId, effectiveFrom, {
        transaction,
      });
      const activated = await this.repository.activateRuleset(
        version,
        { approvedByPlatformUserId: actorPlatformUserId(input.currentUser), effectiveFrom, now },
        { transaction },
      );
      await this.repository.createAudit(
        {
          ...auditBase(input.context, input.currentUser),
          actionCode: 'risk_policy.ruleset_version.activate',
          targetType: 'risk_ruleset_version',
          targetId: input.rulesetVersionId,
          payload: { activationReason: input.body.activationReason, retiredCount },
          occurredAt: now,
        },
        { transaction },
      );
      await this.repository.createDataChange(
        {
          tenantId: input.context.tenantId,
          tableName: 'risk_ruleset_versions',
          recordId: input.rulesetVersionId,
          changeType: 'activate',
          actorType: input.currentUser.role,
          actorInternalUserId: input.currentUser.internalUserId ?? null,
          actorPlatformUserId: actorPlatformUserId(input.currentUser),
          reason: input.body.activationReason,
          newValues: { status: 'active', effectiveFrom: effectiveFrom.toISOString(), retiredCount },
          happenedAt: now,
        },
        { transaction },
      );
      return {
        riskRulesetVersionId: String(activated.id),
        status: activated.status,
        effectiveFrom: activated.effectiveFrom,
        retiredPreviousActiveRulesets: retiredCount,
      };
    });
  }
}
