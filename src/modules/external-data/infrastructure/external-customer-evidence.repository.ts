/**
 * @file Puerto de persistencia: encapsula consultas, locks y escrituras.
 * @business Esta pieza incorpora evidencia KYC, financiera y de confianza con control de costo, consentimiento y disponibilidad.
 * @system aísla proveedores detrás de adaptadores resilientes y políticas de gobierno, ejecución y evidencia.
 */
import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { Transaction } from 'sequelize';
import { CustomerObservationModel, FeatureSnapshotModel } from '../../../database/models/index.js';
import { NormalizedExternalObservation } from '../domain/external-provider.types.js';

type QueryOptions = { transaction?: Transaction };

/** Agregado «evidencia del cliente»: observaciones y snapshots de features derivados de proveedores. */
@Injectable()
export class ExternalCustomerEvidenceRepository {
  constructor(
    @InjectModel(CustomerObservationModel) private readonly customerObservationModel: typeof CustomerObservationModel,
    @InjectModel(FeatureSnapshotModel) private readonly featureSnapshotModel: typeof FeatureSnapshotModel,
  ) {}

  listCustomerObservations(tenantId: string, customerId: string, limit = 50): Promise<CustomerObservationModel[]> {
    return this.customerObservationModel.findAll({
      where: { tenantId, customerId, sourceType: 'external_provider' },
      order: [['captured_at', 'DESC']],
      limit,
    });
  }

  listCustomerFeatureSnapshots(tenantId: string, customerId: string, limit = 20): Promise<FeatureSnapshotModel[]> {
    return this.featureSnapshotModel.findAll({
      where: { tenantId, customerId, triggeringEntityType: 'data_provider_request' },
      order: [['_created_at', 'DESC']],
      limit,
    });
  }

  async createObservations(
    input: {
      tenantId: string;
      customerId: string;
      providerId: string;
      requestId: string;
      observations: NormalizedExternalObservation[];
      now: Date;
    },
    options?: QueryOptions,
  ): Promise<void> {
    if (input.observations.length === 0) return;
    // bulkCreate en vez de un create() secuencial por observación: cada llamada a un provider
    // externo (no servida por cache) normaliza entre 1 y varias observaciones que van todas a la
    // misma tabla en la misma forma.
    await this.customerObservationModel.bulkCreate(
      input.observations.map(
        (observation) =>
          ({
            tenantId: input.tenantId,
            customerId: input.customerId,
            sessionId: null,
            deviceId: null,
            observationCode: observation.observationKey,
            valueText: observation.valueType === 'STRING' ? (observation.valueString ?? null) : null,
            valueNumber:
              observation.valueType === 'NUMBER' && typeof observation.valueNumber === 'number' ? observation.valueNumber.toFixed(4) : null,
            valueBoolean: observation.valueType === 'BOOLEAN' ? (observation.valueBoolean ?? null) : null,
            valueJson: observation.valueType === 'JSON' ? (observation.valueJson ?? null) : null,
            sourceType: 'external_provider',
            sourceProviderId: input.providerId,
            evidenceId: null,
            confidenceScore: typeof observation.confidenceScore === 'number' ? (observation.confidenceScore * 100).toFixed(2) : null,
            verificationStatus: observation.verified
              ? 'verified'
              : observation.manualReviewRequired
                ? 'manual_review_required'
                : 'unverified',
            capturedAt: input.now,
            validFrom: input.now,
            validUntil: null,
            derivationMethod: `external_provider_request:${input.requestId}`,
            derivationVersion: 'external-data-v1',
            createdAtValue: input.now,
          }) as Record<string, unknown>,
      ) as never[],
      options,
    );
  }

  createFeatureSnapshot(
    input: {
      tenantId: string;
      customerId: string;
      providerCode: string;
      requestId: string;
      featuresJson: Record<string, unknown>;
      missingFeaturesJson: Record<string, unknown>;
      integrityHash: string;
      now: Date;
    },
    options?: QueryOptions,
  ): Promise<FeatureSnapshotModel> {
    return this.featureSnapshotModel.create(
      {
        tenantId: input.tenantId,
        subjectType: 'customer',
        subjectId: input.customerId,
        customerId: input.customerId,
        deviceId: null,
        sessionId: null,
        onboardingFlowId: null,
        riskAssessmentRunId: null,
        snapshotReason: `external_provider_${input.providerCode.toLowerCase()}`,
        triggeringEntityType: 'data_provider_request',
        triggeringEntityId: input.requestId,
        featureSetVersion: 'external-data-v1',
        catalogVersionsJson: {},
        featuresJson: input.featuresJson,
        missingFeaturesJson: input.missingFeaturesJson,
        integrityHash: input.integrityHash,
        createdAtValue: input.now,
      } as Record<string, unknown>,
      options,
    );
  }
}
