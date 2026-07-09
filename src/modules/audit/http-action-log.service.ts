import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { FindOptions } from 'sequelize';
import { OperationalAuditLogModel, SystemActionLogModel, SystemEndpointCatalogModel } from '../../database/models/index.js';
import { redactSensitiveObject } from '../../common/utils/privacy/redaction.util.js';
import { endpointPathMatches, endpointPathSpecificity } from '../systems-ops/endpoint-code.util.js';
import { hashPayload, idempotencyLast4, sanitizeForSystemsOps } from '../systems-ops/systems-sanitizer.js';

export type HttpActionLogInput = {
  tenantId: string | null;
  actorType: string | null;
  actorRole?: string | null;
  actorUserId?: string | null;
  actorInternalUserId: string | null;
  actorPlatformUserId: string | null;
  actionCode: string;
  targetType: string;
  targetId: string | null;
  ipAddress: string | null;
  userAgent: string | null;
  payload: Record<string, unknown>;
  occurredAt: Date;
  requestId?: string | null;
  correlationId?: string | null;
  method?: string | null;
  routeTemplate?: string | null;
  resolvedUrlSanitized?: string | null;
  module?: string | null;
  actionName?: string | null;
  responseStatusCode?: number | null;
  durationMs?: number | null;
  idempotencyKey?: string | null;
  riskLevel?: string | null;
  containsPii?: boolean | null;
  errorCode?: string | null;
  errorMessage?: string | null;
};

@Injectable()
export class HttpActionLogService {
  constructor(
    @InjectModel(OperationalAuditLogModel)
    private readonly auditModel: typeof OperationalAuditLogModel,
    @InjectModel(SystemActionLogModel)
    private readonly systemActionLogModel: typeof SystemActionLogModel,
    @InjectModel(SystemEndpointCatalogModel)
    private readonly endpointCatalogModel: typeof SystemEndpointCatalogModel,
  ) {}

  async createHttpAction(input: HttpActionLogInput): Promise<void> {
    const sanitizedPayload = sanitizeForSystemsOps(input.payload);
    await Promise.all([this.createOperationalAuditLog(input, sanitizedPayload), this.createSystemActionLog(input, sanitizedPayload)]);
  }

  private createOperationalAuditLog(
    input: HttpActionLogInput,
    sanitizedPayload: Record<string, unknown>,
  ): Promise<OperationalAuditLogModel> {
    return this.auditModel.create({
      tenantId: input.tenantId,
      actorType: input.actorType,
      actorInternalUserId: input.actorInternalUserId,
      actorPlatformUserId: input.actorPlatformUserId,
      actionCode: input.actionCode,
      targetType: input.targetType,
      targetId: input.targetId,
      ipAddress: input.ipAddress,
      userAgent: input.userAgent,
      payloadJson: redactSensitiveObject(sanitizedPayload) as Record<string, unknown>,
      occurredAt: input.occurredAt,
      createdAtValue: input.occurredAt,
    } as never);
  }

  private async createSystemActionLog(input: HttpActionLogInput, sanitizedPayload: Record<string, unknown>): Promise<SystemActionLogModel> {
    const endpoint = input.method && input.resolvedUrlSanitized ? await this.findEndpoint(input.method, input.resolvedUrlSanitized) : null;
    const idempotencyKeyHash = input.idempotencyKey ? hashPayload(input.idempotencyKey) : null;
    return this.systemActionLogModel.create({
      requestId: input.requestId ?? input.correlationId ?? null,
      correlationId: input.correlationId ?? null,
      endpointCatalogId: endpoint?.id ?? null,
      actorUserId: input.actorUserId ?? null,
      actorType: input.actorType,
      actorRole: input.actorRole ?? input.actorType,
      actorInternalUserId: input.actorInternalUserId,
      actorPlatformUserId: input.actorPlatformUserId,
      method: input.method ?? 'UNKNOWN',
      routeTemplate: input.routeTemplate ?? null,
      resolvedUrlSanitized: input.resolvedUrlSanitized ?? String(sanitizedPayload.path ?? 'unknown'),
      module: endpoint?.module ?? input.module ?? null,
      actionName: input.actionName ?? input.actionCode,
      ipAddress: input.ipAddress,
      userAgent: input.userAgent,
      targetType: input.targetType,
      targetId: input.targetId,
      merchantId: null,
      customerId: input.payload.customerId ? String(input.payload.customerId) : null,
      requestPayloadSanitized: sanitizedPayload,
      requestPayloadHash: hashPayload(input.payload),
      responseStatusCode: input.responseStatusCode ?? null,
      responseSummarySanitized: sanitizeForSystemsOps({ statusCode: input.responseStatusCode, errorCode: input.errorCode }),
      errorCode: input.errorCode ?? null,
      errorMessage: input.errorMessage ?? null,
      durationMs: input.durationMs ?? null,
      idempotencyKeyHash,
      idempotencyKeyLast4: idempotencyLast4(input.idempotencyKey),
      riskLevel: endpoint?.riskLevel ?? input.riskLevel ?? 'LOW',
      containsPii: endpoint?.containsPii ?? input.containsPii ?? false,
      occurredAt: input.occurredAt,
      createdAtValue: input.occurredAt,
    } as never);
  }

  private async findEndpoint(method: string, path: string): Promise<SystemEndpointCatalogModel | null> {
    const normalizedMethod = method.toUpperCase();
    const exact = await this.endpointCatalogModel.findOne({ where: { method: normalizedMethod, fullPath: path } } as FindOptions);
    if (exact) return exact;

    const candidates = await this.endpointCatalogModel.findAll({ where: { method: normalizedMethod, status: 'ACTIVE' } } as FindOptions);
    return (
      candidates
        .filter((endpoint) => endpointPathMatches(endpoint.fullPath, path))
        .sort((a, b) => endpointPathSpecificity(b.fullPath) - endpointPathSpecificity(a.fullPath))[0] ?? null
    );
  }
}
