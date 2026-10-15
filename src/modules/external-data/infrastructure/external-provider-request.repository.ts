/**
 * @file Puerto de persistencia: encapsula consultas, locks y escrituras.
 * @business Esta pieza incorpora evidencia KYC, financiera y de confianza con control de costo, consentimiento y disponibilidad.
 * @system aísla proveedores detrás de adaptadores resilientes y políticas de gobierno, ejecución y evidencia.
 */
import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { Op, Transaction } from 'sequelize';
import { DataProviderRequestModel, DataProviderResponseModel } from '../../../database/models/index.js';
import { providerRequestCountWhere, type ProviderRequestCountQuery } from '../provider-request-count.filter.js';

type QueryOptions = { transaction?: Transaction };

/** Agregado «solicitud a proveedor»: la solicitud, sus respuestas y los conteos de auditoría. */
@Injectable()
export class ExternalProviderRequestRepository {
  constructor(
    @InjectModel(DataProviderRequestModel) private readonly dataProviderRequestModel: typeof DataProviderRequestModel,
    @InjectModel(DataProviderResponseModel) private readonly dataProviderResponseModel: typeof DataProviderResponseModel,
  ) {}

  findProviderRequestById(requestId: string): Promise<DataProviderRequestModel | null> {
    return this.dataProviderRequestModel.findByPk(requestId);
  }

  findProviderRequestByIdAndTenant(tenantId: string, requestId: string): Promise<DataProviderRequestModel | null> {
    return this.dataProviderRequestModel.findOne({ where: { tenantId, id: requestId } });
  }

  findProviderResponsesByRequestId(requestId: string): Promise<DataProviderResponseModel[]> {
    return this.dataProviderResponseModel.findAll({
      where: { providerRequestId: requestId },
      order: [['_created_at', 'DESC']],
      limit: 10,
    });
  }

  findProviderResponsesByRequestIdAndTenant(tenantId: string, requestId: string): Promise<DataProviderResponseModel[]> {
    return this.dataProviderResponseModel.findAll({
      where: { tenantId, providerRequestId: requestId },
      order: [['_created_at', 'DESC']],
      limit: 10,
    });
  }

  findIdempotentProviderRequest(tenantId: string, idempotencyKey: string): Promise<DataProviderRequestModel | null> {
    return this.dataProviderRequestModel.findOne({ where: { tenantId, idempotencyKey }, order: [['_created_at', 'DESC']] });
  }

  findReusableProviderRequest(input: {
    tenantId: string;
    providerId: string;
    customerId?: string;
    queryType: string;
    requestPayloadHash: string;
    since: Date;
  }): Promise<DataProviderRequestModel | null> {
    const where: Record<string, unknown> = {
      tenantId: input.tenantId,
      providerId: input.providerId,
      requestType: input.queryType,
      requestPayloadHash: input.requestPayloadHash,
      responseStatus: { [Op.in]: ['COMPLETED', 'MOCKED', 'DATA_NOT_AVAILABLE'] },
      requestedAt: { [Op.gte]: input.since },
    };
    if (input.customerId) where.customerId = input.customerId;
    return this.dataProviderRequestModel.findOne({ where, order: [['requested_at', 'DESC']] });
  }

  listProviderRequests(input: {
    tenantId?: string;
    providerId?: string;
    customerId?: string;
    from: Date;
    to?: Date;
    limit?: number;
  }): Promise<DataProviderRequestModel[]> {
    const where: Record<string, unknown> = { requestedAt: { [Op.gte]: input.from } };
    if (input.to) where.requestedAt = { [Op.gte]: input.from, [Op.lt]: input.to };
    if (input.tenantId) where.tenantId = input.tenantId;
    if (input.providerId) where.providerId = input.providerId;
    if (input.customerId) where.customerId = input.customerId;
    return this.dataProviderRequestModel.findAll({ where, order: [['requested_at', 'DESC']], limit: input.limit ?? 5000 });
  }

  /** Sin `tenantId` mira todos los tenants: sólo para la compuerta de producción, que es de plataforma. */
  listRecentProviderResponses(limit: number, tenantId?: string): Promise<DataProviderResponseModel[]> {
    return this.dataProviderResponseModel.findAll({ where: tenantId ? { tenantId } : {}, order: [['_created_at', 'DESC']], limit });
  }

  countRequests(input: ProviderRequestCountQuery): Promise<number> {
    return this.dataProviderRequestModel.count({ where: providerRequestCountWhere(input) });
  }

  listIdempotencyAuditRequests(input: { tenantId?: string; from: Date; limit?: number }): Promise<DataProviderRequestModel[]> {
    const where: Record<string, unknown> = { requestedAt: { [Op.gte]: input.from }, idempotencyKey: { [Op.ne]: null } };
    if (input.tenantId) where.tenantId = input.tenantId;
    return this.dataProviderRequestModel.findAll({ where, order: [['requested_at', 'DESC']], limit: input.limit ?? 10000 });
  }

  createProviderRequest(
    input: {
      tenantId: string;
      providerId: string;
      customerId?: string;
      consentId?: string;
      requestType: string;
      purposeCode: string;
      decisionStage: string;
      modeUsed: string;
      requestPayloadHash: string;
      idempotencyKey?: string;
      responseStatus: string;
      responseCode?: string;
      estimatedCostAmount?: string;
      actualCostAmount?: string;
      currency?: string;
      requestedByUserId?: string;
      approvedByAdminId?: string;
      approvalStatus?: string;
      errorMessageSafe?: string;
      metadataJson?: Record<string, unknown>;
      cachedFromRequestId?: string;
      retryOfRequestId?: string;
      now: Date;
    },
    options?: QueryOptions,
  ): Promise<DataProviderRequestModel> {
    return this.dataProviderRequestModel.create(
      {
        tenantId: input.tenantId,
        providerId: input.providerId,
        customerId: input.customerId ?? null,
        consentId: input.consentId ?? null,
        riskAssessmentRunId: null,
        requestType: input.requestType,
        providerRequestRef: null,
        requestPayloadHash: input.requestPayloadHash,
        idempotencyKey: input.idempotencyKey ?? null,
        responseStatus: input.responseStatus,
        responseCode: input.responseCode ?? null,
        purposeCode: input.purposeCode,
        decisionStage: input.decisionStage,
        modeUsed: input.modeUsed,
        estimatedCostAmount: input.estimatedCostAmount ?? null,
        actualCostAmount: input.actualCostAmount ?? null,
        currency: input.currency ?? null,
        requestedByUserId: input.requestedByUserId ?? null,
        approvedByAdminId: input.approvedByAdminId ?? null,
        approvalStatus: input.approvalStatus ?? null,
        errorMessageSafe: input.errorMessageSafe ?? null,
        metadataJson: input.metadataJson ?? null,
        cachedFromRequestId: input.cachedFromRequestId ?? null,
        retryOfRequestId: input.retryOfRequestId ?? null,
        latencyMs: null,
        requestedAt: input.now,
        respondedAt: null,
        createdAtValue: input.now,
      } as Record<string, unknown>,
      options,
    );
  }

  updateProviderRequest(
    request: DataProviderRequestModel,
    patch: {
      responseStatus: string;
      responseCode?: string;
      latencyMs?: number;
      respondedAt?: Date;
      providerRequestRef?: string;
      actualCostAmount?: string;
      errorMessageSafe?: string;
      metadataJson?: Record<string, unknown>;
    },
    options?: QueryOptions,
  ): Promise<DataProviderRequestModel> {
    return request.update(
      {
        responseStatus: patch.responseStatus,
        responseCode: patch.responseCode ?? request.responseCode,
        latencyMs: patch.latencyMs ?? request.latencyMs,
        respondedAt: patch.respondedAt ?? request.respondedAt,
        providerRequestRef: patch.providerRequestRef ?? request.providerRequestRef,
        actualCostAmount: patch.actualCostAmount ?? request.actualCostAmount,
        errorMessageSafe: patch.errorMessageSafe ?? request.errorMessageSafe,
        metadataJson: patch.metadataJson ?? request.metadataJson,
      },
      options,
    );
  }

  createProviderResponse(
    input: {
      tenantId: string;
      providerRequestId: string;
      redactedPayloadJson: Record<string, unknown>;
      normalizedPayloadJson: Record<string, unknown>;
      responseHash: string;
      providerStatusCode?: number;
      providerReference?: string;
      containsSensitiveData: boolean;
      now: Date;
    },
    options?: QueryOptions,
  ): Promise<DataProviderResponseModel> {
    return this.dataProviderResponseModel.create(
      {
        tenantId: input.tenantId,
        providerRequestId: input.providerRequestId,
        payloadStorageStrategy: 'inline_redacted',
        responsePayloadJson: null,
        redactedPayloadJson: input.redactedPayloadJson,
        rawPayloadS3Key: null,
        responseHash: input.responseHash,
        providerStatusCode: input.providerStatusCode ?? null,
        providerReference: input.providerReference ?? null,
        normalizedPayloadJson: input.normalizedPayloadJson,
        containsSensitiveData: input.containsSensitiveData,
        retentionPolicyId: null,
        retentionUntil: null,
        createdAtValue: input.now,
      } as Record<string, unknown>,
      options,
    );
  }
}
