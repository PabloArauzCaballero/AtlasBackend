import { Injectable } from '@nestjs/common';
import { InjectConnection } from '@nestjs/sequelize';
import { Sequelize } from 'sequelize-typescript';
import { AuthenticatedUser } from '../../../common/types/auth.types.js';
import { dataGovernanceDto } from '../catalog-management.mapper.js';
import { CatalogManagementRepository } from '../catalog-management.repository.js';
import { DataGovernancePolicyPackageDto } from '../catalog-management.schemas.js';
import { actorPlatformUserId, assertInternal, auditBase, RequestContext, requireIdempotency } from './catalog-management.shared.js';

@Injectable()
export class CatalogDataGovernanceService {
  constructor(
    private readonly repository: CatalogManagementRepository,
    @InjectConnection() private readonly sequelize: Sequelize,
  ) {}

  async getDataGovernancePolicies(input: { currentUser: AuthenticatedUser }) {
    assertInternal(input.currentUser);
    return dataGovernanceDto(await this.repository.listDataGovernancePolicies());
  }

  async upsertDataGovernancePackage(input: {
    body: DataGovernancePolicyPackageDto;
    currentUser: AuthenticatedUser;
    context: RequestContext;
  }) {
    assertInternal(input.currentUser);
    requireIdempotency(input.context);
    const now = new Date();
    return this.sequelize.transaction(async (transaction) => {
      let privacyPurposes = 0;
      let retentionPolicies = 0;
      let dataProviders = 0;
      let classificationPolicies = 0;
      let sensitiveFieldRules = 0;
      let dataQualityRules = 0;
      for (const item of input.body.privacyPurposes) {
        privacyPurposes += 1;
        await this.repository.upsertPrivacyPurpose(
          {
            purposeCode: item.purposeCode,
            purposeName: item.purposeName,
            legalBasis: item.legalBasis ?? null,
            description: item.description ?? null,
            requiresExplicitConsent: item.requiresExplicitConsent,
            isActive: true,
            createdAtValue: now,
            updatedAtValue: now,
          },
          { transaction },
        );
      }
      for (const item of input.body.retentionPolicies) {
        retentionPolicies += 1;
        await this.repository.upsertRetentionPolicy(
          {
            policyCode: item.policyCode,
            appliesTo: item.appliesTo,
            retentionDays: item.retentionDays,
            postRetentionAction: item.postRetentionAction,
            legalBasis: item.legalBasis ?? null,
            description: item.description ?? null,
            isActive: true,
            createdAtValue: now,
            updatedAtValue: now,
          },
          { transaction },
        );
      }
      for (const item of input.body.dataProviders) {
        dataProviders += 1;
        await this.repository.upsertDataProvider(
          {
            providerCode: item.providerCode,
            providerName: item.providerName,
            providerType: item.providerType,
            reliabilityScore: item.reliabilityScore ?? null,
            supportsRetroData: item.supportsRetroData,
            defaultRetentionPolicyId: item.defaultRetentionPolicyId ?? null,
            isActive: true,
            createdAtValue: now,
            updatedAtValue: now,
          },
          { transaction },
        );
      }
      for (const item of input.body.classificationPolicies) {
        classificationPolicies += 1;
        await this.repository.upsertClassificationPolicy(
          {
            classificationCode: item.classificationCode,
            classificationName: item.classificationName,
            sensitivityLevel: item.sensitivityLevel,
            allowedStorageModesJson: item.allowedStorageModes,
            defaultStorageMode: item.defaultStorageMode ?? null,
            defaultRetentionPolicyId: item.defaultRetentionPolicyId ?? null,
            encryptionRequired: item.encryptionRequired,
            hashingRequired: item.hashingRequired,
            rawStorageAllowed: item.rawStorageAllowed,
            description: item.description ?? null,
            createdAtValue: now,
            updatedAtValue: now,
          },
          { transaction },
        );
      }
      for (const item of input.body.sensitiveFieldRules) {
        sensitiveFieldRules += 1;
        await this.repository.upsertSensitiveFieldRule(
          {
            tableName: item.tableName,
            fieldName: item.fieldName,
            classificationCode: item.classificationCode,
            storageMode: item.storageMode,
            searchStrategy: item.searchStrategy ?? null,
            maskingStrategy: item.maskingStrategy ?? null,
            accessPolicyCode: item.accessPolicyCode ?? null,
            retentionPolicyId: item.retentionPolicyId ?? null,
            isActive: true,
            createdAtValue: now,
            updatedAtValue: now,
          },
          { transaction },
        );
      }
      for (const item of input.body.dataQualityRules) {
        dataQualityRules += 1;
        await this.repository.upsertDataQualityRule(
          {
            ruleCode: item.ruleCode,
            ruleName: item.ruleName,
            targetTable: item.targetTable,
            targetField: item.targetField ?? null,
            severity: item.severity,
            expressionJson: item.expressionJson,
            expectedAction: item.expectedAction,
            buildPhase: item.buildPhase ?? null,
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
          actionCode: 'data_governance.policy_package.upsert',
          targetType: 'data_governance_policy_package',
          targetId: 'current',
          payload: { privacyPurposes, retentionPolicies, dataProviders, classificationPolicies, sensitiveFieldRules, dataQualityRules },
          occurredAt: now,
        },
        { transaction },
      );
      await this.repository.createDataChange(
        {
          tenantId: input.context.tenantId,
          tableName: 'data_governance_policies',
          recordId: 'package',
          changeType: 'upsert_package',
          actorType: input.currentUser.role,
          actorInternalUserId: input.currentUser.internalUserId ?? null,
          actorPlatformUserId: actorPlatformUserId(input.currentUser),
          reason: 'Paquete de gobierno de datos registrado.',
          newValues: { privacyPurposes, retentionPolicies, dataProviders, classificationPolicies, sensitiveFieldRules, dataQualityRules },
          happenedAt: now,
        },
        { transaction },
      );
      return {
        privacyPurposesProcessed: privacyPurposes,
        retentionPoliciesProcessed: retentionPolicies,
        dataProvidersProcessed: dataProviders,
        classificationPoliciesProcessed: classificationPolicies,
        sensitiveFieldRulesProcessed: sensitiveFieldRules,
        dataQualityRulesProcessed: dataQualityRules,
      };
    });
  }
}
