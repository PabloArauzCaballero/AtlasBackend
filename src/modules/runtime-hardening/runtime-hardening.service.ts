import { ConflictException, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { Op } from 'sequelize';
import { sha256Hex } from '../../common/utils/crypto/hash.util.js';
import { redactSensitiveObject, stableStringify } from '../../common/utils/privacy/redaction.util.js';
import { IdempotencyKeyModel, OutboxEventModel } from '../../database/models/index.js';

export type IdempotencyLookupResult =
  { mode: 'execute'; record: IdempotencyKeyModel } | { mode: 'replay'; responseBody: unknown; responseStatus: number | null };

@Injectable()
export class RuntimeHardeningService {
  constructor(
    @InjectModel(IdempotencyKeyModel) private readonly idempotencyModel: typeof IdempotencyKeyModel,
    @InjectModel(OutboxEventModel) private readonly outboxModel: typeof OutboxEventModel,
  ) {}

  requestHash(body: unknown, query: unknown, params: unknown): string {
    return sha256Hex(stableStringify({ body: redactSensitiveObject(body), query, params }));
  }

  async claimIdempotency(input: {
    tenantScope: string;
    actorType: string | null;
    actorId: string | null;
    idempotencyKey: string;
    scope: string;
    requestHash: string;
    now: Date;
  }): Promise<IdempotencyLookupResult> {
    const existing = await this.idempotencyModel.findOne({
      where: { tenantScope: input.tenantScope, scope: input.scope, idempotencyKey: input.idempotencyKey },
    });

    if (existing) {
      if (existing.requestHash !== input.requestHash) {
        throw new ConflictException('IDEMPOTENCY_CONFLICT');
      }
      if (existing.status === 'completed') {
        return { mode: 'replay', responseBody: existing.responseBodyJson, responseStatus: existing.responseStatus };
      }
      if (existing.status === 'processing' && existing.lockedUntil && existing.lockedUntil > input.now) {
        throw new ConflictException('IDEMPOTENCY_REQUEST_IN_PROGRESS');
      }
      existing.status = 'processing';
      existing.lockedUntil = new Date(input.now.getTime() + 5 * 60_000);
      existing.updatedAtValue = input.now;
      await existing.save();
      return { mode: 'execute', record: existing };
    }

    const record = await this.idempotencyModel.create({
      tenantScope: input.tenantScope,
      actorType: input.actorType,
      actorId: input.actorId,
      idempotencyKey: input.idempotencyKey,
      scope: input.scope,
      requestHash: input.requestHash,
      status: 'processing',
      responseStatus: null,
      responseBodyJson: null,
      lockedUntil: new Date(input.now.getTime() + 5 * 60_000),
      completedAt: null,
      createdAtValue: input.now,
      updatedAtValue: input.now,
    });
    return { mode: 'execute', record };
  }

  async completeIdempotency(record: IdempotencyKeyModel, responseStatus: number, responseBody: unknown): Promise<void> {
    const now = new Date();
    record.status = 'completed';
    record.responseStatus = responseStatus;
    record.responseBodyJson = redactSensitiveObject(responseBody) as Record<string, unknown>;
    record.lockedUntil = null;
    record.completedAt = now;
    record.updatedAtValue = now;
    await record.save();
  }

  async failIdempotency(record: IdempotencyKeyModel): Promise<void> {
    const now = new Date();
    record.status = 'failed';
    record.lockedUntil = null;
    record.updatedAtValue = now;
    await record.save();
  }

  async emitApiCommandCompleted(input: {
    tenantId: string | null;
    aggregateType: string;
    aggregateId: string | null;
    eventCode: string;
    payload: Record<string, unknown>;
    correlationId: string | null;
  }): Promise<void> {
    const now = new Date();
    await this.outboxModel.create({
      tenantId: input.tenantId,
      aggregateType: input.aggregateType,
      aggregateId: input.aggregateId,
      eventCode: input.eventCode,
      eventPayloadJson: redactSensitiveObject(input.payload) as Record<string, unknown>,
      status: 'pending',
      attempts: 0,
      availableAt: now,
      processedAt: null,
      lastError: null,
      correlationId: input.correlationId,
      createdAtValue: now,
      updatedAtValue: now,
    });
  }

  listPendingOutbox(limit: number): Promise<OutboxEventModel[]> {
    return this.outboxModel.findAll({
      where: { status: 'pending', availableAt: { [Op.lte]: new Date() } },
      order: [
        ['availableAt', 'ASC'],
        ['id', 'ASC'],
      ],
      limit,
    });
  }

  async markOutboxProcessed(event: OutboxEventModel): Promise<void> {
    const now = new Date();
    event.status = 'processed';
    event.attempts = (event.attempts ?? 0) + 1;
    event.processedAt = now;
    event.updatedAtValue = now;
    await event.save();
  }
}
