import { Injectable } from '@nestjs/common';
import { InjectConnection } from '@nestjs/sequelize';
import { Sequelize } from 'sequelize-typescript';
import { AuthenticatedUser } from '../../../common/types/auth.types.js';
import { definitionDtos } from '../catalog-management.mapper.js';
import { CatalogManagementRepository } from '../catalog-management.repository.js';
import { DefinitionsPackageDto, DefinitionsQueryDto } from '../catalog-management.schemas.js';
import { actorPlatformUserId, assertInternal, auditBase, RequestContext, requireIdempotency } from './catalog-management.shared.js';

@Injectable()
export class CatalogDefinitionsService {
  constructor(
    private readonly repository: CatalogManagementRepository,
    @InjectConnection() private readonly sequelize: Sequelize,
  ) {}

  async listDefinitions(input: { query: DefinitionsQueryDto; currentUser: AuthenticatedUser }) {
    assertInternal(input.currentUser);
    return definitionDtos(await this.repository.listDefinitions(input.query));
  }

  async upsertDefinitionsPackage(input: { body: DefinitionsPackageDto; currentUser: AuthenticatedUser; context: RequestContext }) {
    assertInternal(input.currentUser);
    requireIdempotency(input.context);
    const now = new Date();
    return this.sequelize.transaction(async (transaction) => {
      let events = 0;
      let observations = 0;
      let attributes = 0;
      let features = 0;
      for (const item of input.body.definitions.events) {
        events += 1;
        await this.repository.upsertEventDefinition(
          {
            eventCode: item.eventCode,
            eventName: item.eventName,
            eventFamily: item.eventFamily ?? input.body.domain,
            sourcePackage: item.sourcePackage ?? input.body.domain,
            targetTablesJson: { tables: item.targetTables },
            expectedPayloadSchemaJson: item.expectedPayloadSchema,
            riskDimension: item.riskDimension ?? null,
            buildPhase: item.buildPhase ?? null,
            dataClassificationCode: item.dataClassificationCode ?? null,
            retentionPolicyId: item.retentionPolicyId ?? null,
            isHighVolume: item.isHighVolume ?? false,
            isActive: true,
            createdAtValue: now,
            updatedAtValue: now,
          },
          { transaction },
        );
      }
      for (const item of input.body.definitions.observations) {
        observations += 1;
        await this.repository.upsertObservationDefinition(
          {
            observationCode: item.observationCode,
            observationName: item.observationName,
            dataType: item.dataType ?? 'string',
            sourceGroup: item.sourceGroup ?? input.body.domain,
            expectedAvailabilityStage: item.expectedAvailabilityStage ?? null,
            buildPhase: item.buildPhase ?? null,
            dataClassificationCode: item.dataClassificationCode ?? null,
            riskDimension: item.riskDimension ?? null,
            requiresConsent: item.requiresConsent ?? false,
            allowedForCreditDecision: item.allowedForCreditDecision ?? false,
            allowedForFraudDecision: item.allowedForFraudDecision ?? false,
            legalReviewStatus: item.legalReviewStatus ?? 'pending',
            prohibitedReasonCode: null,
            fairnessReviewRequired: item.fairnessReviewRequired ?? false,
            retentionPolicyId: item.retentionPolicyId ?? null,
            isActive: true,
            createdAtValue: now,
            updatedAtValue: now,
          },
          { transaction },
        );
      }
      for (const item of input.body.definitions.attributes) {
        attributes += 1;
        await this.repository.upsertAttributeDefinition(
          {
            attributeCode: item.attributeCode,
            attributeName: item.attributeName,
            entityScope: item.entityScope ?? 'customer',
            dataType: item.dataType ?? 'string',
            riskDimension: item.riskDimension ?? null,
            sourceType: item.sourceType ?? input.body.domain,
            availabilityStage: item.availabilityStage ?? null,
            buildPhase: item.buildPhase ?? null,
            dataClassificationCode: item.dataClassificationCode ?? null,
            requiresConsent: item.requiresConsent ?? false,
            isSensitive: item.isSensitive ?? false,
            isModelCandidate: item.isModelCandidate ?? false,
            allowedForCreditDecision: item.allowedForCreditDecision ?? false,
            allowedForFraudDecision: item.allowedForFraudDecision ?? false,
            legalReviewStatus: item.legalReviewStatus ?? 'pending',
            prohibitedReasonCode: null,
            fairnessReviewRequired: item.fairnessReviewRequired ?? false,
            retentionPolicyId: item.retentionPolicyId ?? null,
            isActive: true,
            createdAtValue: now,
            updatedAtValue: now,
          },
          { transaction },
        );
      }
      for (const item of input.body.definitions.features) {
        features += 1;
        await this.repository.upsertFeatureDefinition(
          {
            featureCode: item.featureCode,
            featureName: item.featureName,
            featureFamily: item.featureFamily ?? input.body.domain,
            riskDimension: item.riskDimension ?? null,
            dataType: item.dataType ?? 'number',
            availabilityTier: item.availabilityTier ?? null,
            buildPhase: item.buildPhase ?? null,
            dataClassificationCode: item.dataClassificationCode ?? null,
            calculationKind: item.calculationKind ?? null,
            defaultMissingStrategy: item.defaultMissingStrategy ?? null,
            isModelInput: item.isModelInput ?? false,
            isPolicyRuleInput: item.isPolicyRuleInput ?? false,
            isSensitive: item.isSensitive ?? false,
            allowedForCreditDecision: item.allowedForCreditDecision ?? false,
            allowedForFraudDecision: item.allowedForFraudDecision ?? false,
            legalReviewStatus: item.legalReviewStatus ?? 'pending',
            prohibitedReasonCode: null,
            fairnessReviewRequired: item.fairnessReviewRequired ?? false,
            retentionPolicyId: item.retentionPolicyId ?? null,
            ownerTeam: item.ownerTeam ?? null,
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
          actionCode: 'definitions.package.upsert',
          targetType: 'definitions_package',
          targetId: input.body.domain,
          payload: { events, observations, attributes, features },
          occurredAt: now,
        },
        { transaction },
      );
      await this.repository.createDataChange(
        {
          tenantId: input.context.tenantId,
          tableName: 'definitions',
          recordId: input.body.domain,
          changeType: 'upsert_package',
          actorType: input.currentUser.role,
          actorInternalUserId: input.currentUser.internalUserId ?? null,
          actorPlatformUserId: actorPlatformUserId(input.currentUser),
          reason: 'Paquete de definiciones registrado.',
          newValues: { events, observations, attributes, features },
          happenedAt: now,
        },
        { transaction },
      );
      return {
        domain: input.body.domain,
        eventsProcessed: events,
        observationsProcessed: observations,
        attributesProcessed: attributes,
        featuresProcessed: features,
      };
    });
  }
}
