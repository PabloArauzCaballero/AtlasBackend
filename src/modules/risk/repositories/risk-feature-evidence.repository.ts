/**
 * @file Puerto de persistencia: encapsula consultas, locks y escrituras.
 * @business Conserva con qué información se evaluó a un cliente, y no sólo el resultado.
 * @system escribe y lee la corrida de features, sus valores y el snapshot; la transacción la abre quien orquesta.
 */
import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { FindOptions, Transaction } from 'sequelize';
import { FeatureComputationRunModel, FeatureSnapshotModel, FeatureValueModel } from '../../../database/models/index.js';

type RepositoryOptions = { transaction?: Transaction };

@Injectable()
export class RiskFeatureEvidenceRepository {
  constructor(
    @InjectModel(FeatureComputationRunModel) private readonly featureComputationRunModel: typeof FeatureComputationRunModel,
    @InjectModel(FeatureValueModel) private readonly featureValueModel: typeof FeatureValueModel,
    @InjectModel(FeatureSnapshotModel) private readonly featureSnapshotModel: typeof FeatureSnapshotModel,
  ) {}

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

  async attachSnapshotToRun(snapshot: FeatureSnapshotModel, runId: string, options: RepositoryOptions): Promise<void> {
    snapshot.riskAssessmentRunId = runId;
    await snapshot.save({ transaction: options.transaction });
  }

  findSnapshotByRun(tenantId: string, runId: string): Promise<FeatureSnapshotModel | null> {
    return this.featureSnapshotModel.findOne({ where: { tenantId, riskAssessmentRunId: runId } } as FindOptions);
  }
}
