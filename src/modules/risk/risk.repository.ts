import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { FindOptions, Transaction } from 'sequelize';
import {
  CustomerConsentModel,
  CustomerContactMethodModel,
  CustomerIdentityDocumentModel,
  DataChangeLogModel,
  DataQualityIssueModel,
  FeatureComputationRunModel,
  FeatureLineageLinkModel,
  FeatureSnapshotModel,
  FeatureValueModel,
  FraudCaseModel,
  ManualReviewCaseModel,
  OperationalAuditLogModel,
  RiskAssessmentContextModel,
  RiskAssessmentResultModel,
  RiskAssessmentRunModel,
  RiskFeatureContributionModel,
  RiskRuleFiredModel,
  WatchlistMatchModel,
} from '../../database/models/index.js';

type RepositoryOptions = { transaction?: Transaction };

@Injectable()
export class RiskRepository {
  constructor(
    @InjectModel(RiskAssessmentResultModel)
    private readonly riskAssessmentResultModel: typeof RiskAssessmentResultModel,
    @InjectModel(RiskAssessmentRunModel) private readonly riskAssessmentRunModel: typeof RiskAssessmentRunModel,
    @InjectModel(RiskAssessmentContextModel)
    private readonly riskAssessmentContextModel: typeof RiskAssessmentContextModel,
    @InjectModel(RiskRuleFiredModel) private readonly riskRuleFiredModel: typeof RiskRuleFiredModel,
    @InjectModel(RiskFeatureContributionModel)
    private readonly riskFeatureContributionModel: typeof RiskFeatureContributionModel,
    @InjectModel(FeatureComputationRunModel)
    private readonly featureComputationRunModel: typeof FeatureComputationRunModel,
    @InjectModel(FeatureValueModel) private readonly featureValueModel: typeof FeatureValueModel,
    @InjectModel(FeatureLineageLinkModel) private readonly featureLineageLinkModel: typeof FeatureLineageLinkModel,
    @InjectModel(FeatureSnapshotModel) private readonly featureSnapshotModel: typeof FeatureSnapshotModel,
    @InjectModel(ManualReviewCaseModel) private readonly manualReviewCaseModel: typeof ManualReviewCaseModel,
    @InjectModel(FraudCaseModel) private readonly fraudCaseModel: typeof FraudCaseModel,
    @InjectModel(WatchlistMatchModel) private readonly watchlistMatchModel: typeof WatchlistMatchModel,
    @InjectModel(DataQualityIssueModel) private readonly dataQualityIssueModel: typeof DataQualityIssueModel,
    @InjectModel(DataChangeLogModel) private readonly dataChangeLogModel: typeof DataChangeLogModel,
    @InjectModel(OperationalAuditLogModel) private readonly operationalAuditLogModel: typeof OperationalAuditLogModel,
    @InjectModel(CustomerConsentModel) private readonly consentModel: typeof CustomerConsentModel,
    @InjectModel(CustomerContactMethodModel) private readonly contactMethodModel: typeof CustomerContactMethodModel,
    @InjectModel(CustomerIdentityDocumentModel)
    private readonly identityDocumentModel: typeof CustomerIdentityDocumentModel,
  ) {}

  findLatestCustomerRiskResult(tenantId: string, customerId: string): Promise<RiskAssessmentResultModel | null> {
    return this.riskAssessmentResultModel.findOne({
      where: { tenantId, customerId },
      order: [
        ['decidedAt', 'DESC'],
        ['id', 'DESC'],
      ],
    } as FindOptions);
  }

  findCustomerConsents(tenantId: string, customerId: string): Promise<CustomerConsentModel[]> {
    return this.consentModel.findAll({ where: { tenantId, customerId, granted: true } } as FindOptions);
  }

  findCustomerContacts(tenantId: string, customerId: string): Promise<CustomerContactMethodModel[]> {
    return this.contactMethodModel.findAll({ where: { tenantId, customerId } } as FindOptions);
  }

  findIdentityDocuments(tenantId: string, customerId: string): Promise<CustomerIdentityDocumentModel[]> {
    return this.identityDocumentModel.findAll({ where: { tenantId, customerId } } as FindOptions);
  }

  createFeatureComputationRun(
    values: {
      tenantId: string;
      customerId: string;
      sessionId: string | null;
      deviceId: string | null;
      runReason: string;
      triggerSource: string;
      idempotencyKey: string;
      now: Date;
    },
    options: RepositoryOptions,
  ): Promise<FeatureComputationRunModel> {
    return this.featureComputationRunModel.create(
      {
        tenantId: values.tenantId,
        subjectType: 'customer',
        subjectId: values.customerId,
        customerId: values.customerId,
        sessionId: values.sessionId,
        onboardingFlowId: null,
        deviceId: values.deviceId,
        runReason: values.runReason,
        triggerSource: values.triggerSource,
        idempotencyKey: values.idempotencyKey,
        featureSetVersion: 'atlas-mvp-v1',
        codeVersion: 'rules-v1',
        computedBy: 'backend',
        retryCount: 0,
        startedAt: values.now,
        finishedAt: values.now,
        status: 'completed',
        errorMessage: null,
        createdAtValue: values.now,
      },
      { transaction: options.transaction },
    );
  }

  createFeatureValue(
    values: {
      tenantId: string;
      computationRunId: string;
      customerId: string;
      sessionId: string | null;
      deviceId: string | null;
      featureCode: string;
      valueNumber: string | null;
      valueBoolean: boolean | null;
      valueText: string | null;
      valueJson: Record<string, unknown> | null;
      now: Date;
    },
    options: RepositoryOptions,
  ): Promise<FeatureValueModel> {
    return this.featureValueModel.create(
      {
        tenantId: values.tenantId,
        computationRunId: values.computationRunId,
        featureDefinitionId: null,
        subjectType: 'customer',
        subjectId: values.customerId,
        customerId: values.customerId,
        sessionId: values.sessionId,
        onboardingFlowId: null,
        deviceId: values.deviceId,
        valueText: values.valueText,
        valueNumber: values.valueNumber,
        valueBoolean: values.valueBoolean,
        valueJson: values.valueJson,
        confidenceScore: '1.0000',
        derivationMethod: values.featureCode,
        derivationVersion: 'v1',
        validFrom: values.now,
        validUntil: null,
        createdAtValue: values.now,
      },
      { transaction: options.transaction },
    );
  }

  createFeatureSnapshot(
    values: {
      tenantId: string;
      customerId: string;
      deviceId: string | null;
      sessionId: string | null;
      featuresJson: Record<string, unknown>;
      missingFeaturesJson: Record<string, unknown>;
      integrityHash: string;
      now: Date;
    },
    options: RepositoryOptions,
  ): Promise<FeatureSnapshotModel> {
    return this.featureSnapshotModel.create(
      {
        tenantId: values.tenantId,
        subjectType: 'customer',
        subjectId: values.customerId,
        customerId: values.customerId,
        deviceId: values.deviceId,
        snapshotReason: 'risk_assessment',
        triggeringEntityType: 'customer',
        triggeringEntityId: values.customerId,
        riskAssessmentRunId: null,
        sessionId: values.sessionId,
        onboardingFlowId: null,
        featureSetVersion: 'atlas-mvp-v1',
        catalogVersionsJson: null,
        featuresJson: values.featuresJson,
        missingFeaturesJson: values.missingFeaturesJson,
        integrityHash: values.integrityHash,
        createdAtValue: values.now,
      },
      { transaction: options.transaction },
    );
  }

  createRiskAssessmentRun(
    values: {
      tenantId: string;
      customerId: string;
      sessionId: string | null;
      deviceId: string | null;
      featureSnapshotId: string;
      assessmentType: string;
      triggerSource: string;
      idempotencyKey: string;
      now: Date;
    },
    options: RepositoryOptions,
  ): Promise<RiskAssessmentRunModel> {
    return this.riskAssessmentRunModel.create(
      {
        tenantId: values.tenantId,
        subjectType: 'customer',
        subjectId: values.customerId,
        customerId: values.customerId,
        sessionId: values.sessionId,
        onboardingFlowId: null,
        deviceId: values.deviceId,
        featureSnapshotId: values.featureSnapshotId,
        riskModelVersionId: null,
        riskRulesetVersionId: null,
        assessmentType: values.assessmentType,
        triggerSource: values.triggerSource,
        idempotencyKey: values.idempotencyKey,
        runStatus: 'completed',
        startedAt: values.now,
        completedAt: values.now,
        latencyMs: 0,
        createdAtValue: values.now,
      },
      { transaction: options.transaction },
    );
  }

  async attachSnapshotToRun(snapshot: FeatureSnapshotModel, runId: string, options: RepositoryOptions): Promise<void> {
    snapshot.riskAssessmentRunId = runId;
    await snapshot.save({ transaction: options.transaction });
  }

  createRiskAssessmentContext(
    values: {
      tenantId: string;
      riskAssessmentRunId: string;
      contextPayloadHash: string;
      now: Date;
    },
    options: RepositoryOptions,
  ): Promise<RiskAssessmentContextModel> {
    return this.riskAssessmentContextModel.create(
      {
        tenantId: values.tenantId,
        riskAssessmentRunId: values.riskAssessmentRunId,
        contextType: 'onboarding',
        externalEntityType: null,
        externalEntityId: null,
        merchantIdSnapshot: null,
        merchantCodeSnapshot: null,
        merchantRiskBandSnapshot: null,
        merchantDefaultRateSnapshot: null,
        storeIdSnapshot: null,
        productCategorySnapshot: null,
        productSubcategorySnapshot: null,
        basketItemCountSnapshot: null,
        basketDuplicateItemCountSnapshot: null,
        basketAnomalyScore: null,
        transactionAmountSnapshot: null,
        currencyCode: 'BOB',
        purchaseToDeclaredIncomeRatio: null,
        downPaymentRequiredPctSnapshot: null,
        downPaymentBehaviorSnapshot: null,
        storeToHomeDistanceMeters: null,
        contextPayloadHash: values.contextPayloadHash,
        createdAtValue: values.now,
      },
      { transaction: options.transaction },
    );
  }

  createRuleFired(
    values: {
      tenantId: string;
      riskAssessmentRunId: string;
      ruleCode: string;
      riskDimension: string;
      outputAction: string;
      reasonCode: string;
      severity: string;
      isHardStop: boolean;
      inputValues: Record<string, unknown>;
      rulesetVersionCode: string;
      now: Date;
    },
    options: RepositoryOptions,
  ): Promise<RiskRuleFiredModel> {
    return this.riskRuleFiredModel.create(
      {
        tenantId: values.tenantId,
        riskAssessmentRunId: values.riskAssessmentRunId,
        riskPolicyRuleId: null,
        ruleCodeSnapshot: values.ruleCode,
        rulesetVersionCodeSnapshot: values.rulesetVersionCode,
        riskDimension: values.riskDimension,
        inputValuesJson: values.inputValues,
        outputAction: values.outputAction,
        reasonCode: values.reasonCode,
        severity: values.severity,
        isHardStop: values.isHardStop,
        firedAt: values.now,
        createdAtValue: values.now,
      },
      { transaction: options.transaction },
    );
  }

  createContribution(
    values: {
      tenantId: string;
      riskAssessmentRunId: string;
      featureCode: string;
      rawValue: Record<string, unknown>;
      scorePoints: string;
      reasonCode: string;
      now: Date;
    },
    options: RepositoryOptions,
  ): Promise<RiskFeatureContributionModel> {
    return this.riskFeatureContributionModel.create(
      {
        tenantId: values.tenantId,
        riskAssessmentRunId: values.riskAssessmentRunId,
        featureCode: values.featureCode,
        rawValueJson: values.rawValue,
        binOrAttribute: null,
        woeValue: null,
        scorePoints: values.scorePoints,
        reasonCode: values.reasonCode,
        createdAtValue: values.now,
      },
      { transaction: options.transaction },
    );
  }

  createRiskResult(
    values: {
      tenantId: string;
      runId: string;
      customerId: string;
      sessionId: string | null;
      deviceId: string | null;
      assessmentType: string;
      recommendedAction: string;
      riskLevel: string;
      scoreTotal: string;
      fraudScore: string;
      identityScore: string;
      deviceRiskScore: string;
      behaviorScore: string;
      contactabilityScore: string;
      consistencyScore: string;
      reasonCodes: Record<string, unknown>;
      featureSnapshotId: string;
      integrityHash: string;
      modelVersionCode: string;
      rulesetVersionCode: string;
      now: Date;
    },
    options: RepositoryOptions,
  ): Promise<RiskAssessmentResultModel> {
    return this.riskAssessmentResultModel.create(
      {
        tenantId: values.tenantId,
        riskAssessmentRunId: values.runId,
        subjectType: 'customer',
        subjectId: values.customerId,
        customerId: values.customerId,
        sessionId: values.sessionId,
        onboardingFlowId: null,
        deviceId: values.deviceId,
        assessmentType: values.assessmentType,
        recommendedAction: values.recommendedAction,
        riskLevel: values.riskLevel,
        scoreTotal: values.scoreTotal,
        fraudScore: values.fraudScore,
        identityScore: values.identityScore,
        deviceRiskScore: values.deviceRiskScore,
        behaviorScore: values.behaviorScore,
        contactabilityScore: values.contactabilityScore,
        consistencyScore: values.consistencyScore,
        reasonCodesJson: values.reasonCodes,
        modelVersionCodeSnapshot: values.modelVersionCode,
        rulesetVersionCodeSnapshot: values.rulesetVersionCode,
        featureSnapshotId: values.featureSnapshotId,
        integrityHash: values.integrityHash,
        decidedAt: values.now,
        createdAtValue: values.now,
      },
      { transaction: options.transaction },
    );
  }

  createManualReviewCase(
    values: {
      tenantId: string;
      customerId: string;
      riskAssessmentRunId: string;
      priority: string;
      caseType: string;
      notes: string;
      now: Date;
    },
    options: RepositoryOptions,
  ): Promise<ManualReviewCaseModel> {
    return this.manualReviewCaseModel.create(
      {
        tenantId: values.tenantId,
        caseCode: `MR-${Date.now()}`,
        customerId: values.customerId,
        riskAssessmentRunId: values.riskAssessmentRunId,
        fraudCaseId: null,
        caseType: values.caseType,
        priority: values.priority,
        status: 'open',
        assignedToInternalUserId: null,
        openedAt: values.now,
        closedAt: null,
        resolution: null,
        notes: values.notes,
        createdAtValue: values.now,
        updatedAtValue: values.now,
        deleted: false,
      },
      { transaction: options.transaction },
    );
  }

  createDataQualityIssue(
    values: { tenantId: string; targetRecordId: string; issueCode: string; now: Date },
    options: RepositoryOptions,
  ): Promise<DataQualityIssueModel> {
    return this.dataQualityIssueModel.create(
      {
        tenantId: values.tenantId,
        qualityRuleId: null,
        targetTable: 'customers',
        targetRecordId: values.targetRecordId,
        issueStatus: values.issueCode,
        detectedAt: values.now,
        resolvedAt: null,
        resolutionNotes: null,
        createdAtValue: values.now,
      },
      { transaction: options.transaction },
    );
  }

  createAudit(
    values: {
      tenantId: string;
      actorType: string;
      actorInternalUserId: string | null;
      actionCode: string;
      targetId: string;
      payload: Record<string, unknown>;
      now: Date;
    },
    options: RepositoryOptions,
  ): Promise<OperationalAuditLogModel> {
    return this.operationalAuditLogModel.create(
      {
        tenantId: values.tenantId,
        actorType: values.actorType,
        actorInternalUserId: values.actorInternalUserId,
        actorPlatformUserId: null,
        actionCode: values.actionCode,
        targetType: 'customer',
        targetId: values.targetId,
        ipAddress: null,
        userAgent: null,
        payloadJson: values.payload,
        occurredAt: values.now,
        createdAtValue: values.now,
      },
      { transaction: options.transaction },
    );
  }

  findRiskRun(tenantId: string, runId: string): Promise<RiskAssessmentRunModel | null> {
    return this.riskAssessmentRunModel.findOne({ where: { tenantId, id: runId } } as FindOptions);
  }

  findRiskResultByRun(tenantId: string, runId: string): Promise<RiskAssessmentResultModel | null> {
    return this.riskAssessmentResultModel.findOne({ where: { tenantId, riskAssessmentRunId: runId } } as FindOptions);
  }

  findRulesByRun(tenantId: string, runId: string): Promise<RiskRuleFiredModel[]> {
    return this.riskRuleFiredModel.findAll({ where: { tenantId, riskAssessmentRunId: runId } } as FindOptions);
  }

  findContributionsByRun(tenantId: string, runId: string): Promise<RiskFeatureContributionModel[]> {
    return this.riskFeatureContributionModel.findAll({ where: { tenantId, riskAssessmentRunId: runId } } as FindOptions);
  }

  findSnapshotByRun(tenantId: string, runId: string): Promise<FeatureSnapshotModel | null> {
    return this.featureSnapshotModel.findOne({ where: { tenantId, riskAssessmentRunId: runId } } as FindOptions);
  }
}
