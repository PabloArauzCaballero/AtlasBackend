/**
 * @file Puerto de persistencia: encapsula consultas, locks y escrituras.
 * @business Guarda y consulta la evaluación de riesgo: corrida, contexto, reglas disparadas, contribuciones y resultado.
 * @system es el agregado de la evaluación; el resultado se corrige sólo con la revisión humana de `applyManualReviewOutcome`.
 */
import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { FindOptions, Transaction } from 'sequelize';
import {
  RiskAssessmentContextModel,
  RiskAssessmentResultModel,
  RiskAssessmentRunModel,
  RiskFeatureContributionModel,
  RiskRuleFiredModel,
} from '../../../database/models/index.js';

type RepositoryOptions = { transaction?: Transaction };

@Injectable()
export class RiskAssessmentRepository {
  constructor(
    @InjectModel(RiskAssessmentResultModel) private readonly riskAssessmentResultModel: typeof RiskAssessmentResultModel,
    @InjectModel(RiskAssessmentRunModel) private readonly riskAssessmentRunModel: typeof RiskAssessmentRunModel,
    @InjectModel(RiskAssessmentContextModel) private readonly riskAssessmentContextModel: typeof RiskAssessmentContextModel,
    @InjectModel(RiskRuleFiredModel) private readonly riskRuleFiredModel: typeof RiskRuleFiredModel,
    @InjectModel(RiskFeatureContributionModel) private readonly riskFeatureContributionModel: typeof RiskFeatureContributionModel,
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
      /** De qué escalón salió la decisión. Se guarda en la fila, no sólo en la respuesta. */
      decisionSource: string;
      /** La ejecución del Motor, cuando decidió él. `null` en los otros dos escalones. */
      decisionExecutionId: string | null;
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
        decisionSource: values.decisionSource,
        decisionExecutionId: values.decisionExecutionId,
        runStatus: 'completed',
        startedAt: values.now,
        completedAt: values.now,
        latencyMs: 0,
        createdAtValue: values.now,
      },
      { transaction: options.transaction },
    );
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

  findRiskRun(tenantId: string, runId: string): Promise<RiskAssessmentRunModel | null> {
    return this.riskAssessmentRunModel.findOne({ where: { tenantId, id: runId } } as FindOptions);
  }

  /**
   * El resultado se corrige con lo que dijo la persona. Es lo que lee la elegibilidad
   * (`latestRisk.recommendedAction`): cerrar el caso sin tocar esto dejaba `RISK_NOT_APPROVED`
   * puesto para siempre aunque el analista hubiera aprobado.
   */
  async applyManualReviewOutcome(
    result: RiskAssessmentResultModel,
    values: { recommendedAction: string; reason: string; now: Date },
    options: RepositoryOptions,
  ): Promise<RiskAssessmentResultModel> {
    result.recommendedAction = values.recommendedAction;
    result.reasonCodesJson = {
      ...(result.reasonCodesJson ?? {}),
      manualReview: { resolution: values.recommendedAction, reason: values.reason, resolvedAt: values.now.toISOString() },
    };
    return result.save({ transaction: options.transaction });
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
}
