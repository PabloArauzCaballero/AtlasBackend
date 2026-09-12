/**
 * @file Servicio de aplicación o dominio: ejecuta reglas y coordina dependencias.
 * @business Esta pieza evita duplicados y pérdida de efectos ante reintentos, concurrencia o fallos parciales.
 * @system centraliza idempotencia y outbox como garantías transversales del runtime HTTP.
 */
import { ConflictException, Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { Op, UniqueConstraintError } from 'sequelize';
import { env } from '../../config/env.js';
import { sha256Hex } from '../../common/utils/crypto/hash.util.js';
import { redactSensitiveObject } from '../../common/utils/privacy/redaction.util.js';
import { IdempotencyKeyModel, OutboxEventModel } from '../../database/models/index.js';
import {
  fingerprintMatches,
  fingerprintRequest,
  operationPolicy,
  sameActor,
  type OperationPolicy,
  type RequestShape,
} from './application/idempotency-policy.js';
import {
  IdempotencyClaimStore,
  LEASE_DURATION_MS,
  newOwnerToken,
  type IdempotencyLease,
} from './infrastructure/idempotency-claim.store.js';

export type IdempotencyLookupResult =
  | { mode: 'execute'; lease: IdempotencyLease; policy: OperationPolicy }
  | { mode: 'replay'; responseBody: unknown; responseStatus: number | null };

/**
 * Secreto de la huella semántica (AT-010). Si no hay uno propio se deriva del de firma de tokens,
 * de modo que un despliegue existente no necesita configurar nada nuevo para seguir funcionando;
 * un secreto dedicado permite rotar la huella sin rotar los tokens.
 */
function fingerprintSecret(): string {
  const dedicated = env.IDEMPOTENCY_FINGERPRINT_SECRET;
  if (dedicated) return dedicated;
  return sha256Hex(`atlas-idempotency-fingerprint:${env.JWT_ACCESS_TOKEN_SECRET}`);
}

@Injectable()
export class RuntimeHardeningService {
  private readonly logger = new Logger(RuntimeHardeningService.name);
  private readonly secret = fingerprintSecret();

  constructor(
    @InjectModel(IdempotencyKeyModel) private readonly idempotencyModel: typeof IdempotencyKeyModel,
    @InjectModel(OutboxEventModel) private readonly outboxModel: typeof OutboxEventModel,
    private readonly claims: IdempotencyClaimStore,
  ) {}

  /** Huella versionada de la petición. Igualdad semántica, no igualdad tras redactar. */
  requestHash(body: unknown, query: unknown, params: unknown): string {
    return fingerprintRequest({ body, query, params }, this.secret);
  }

  private async claimExisting(
    existing: IdempotencyKeyModel,
    input: { request: RequestShape; actorId: string | null; scope: string; now: Date },
  ): Promise<IdempotencyLookupResult> {
    if (!fingerprintMatches(existing.requestHash, input.request, this.secret)) {
      throw new ConflictException('IDEMPOTENCY_CONFLICT');
    }
    // La colisión de OTRA persona bajo la misma clave nunca devuelve la respuesta ajena.
    if (!sameActor(existing.actorId, input.actorId)) {
      throw new ConflictException('IDEMPOTENCY_CONFLICT');
    }
    const policy = operationPolicy(input.scope);
    if (existing.status === 'completed') {
      if (!policy.storeResponse || existing.responseBodyJson === null) {
        // Credenciales/OTP: el resultado no se guardó a propósito; hay que volver a pedirlo.
        throw new ConflictException('IDEMPOTENCY_REPLAY_NOT_AVAILABLE');
      }
      return { mode: 'replay', responseBody: existing.responseBodyJson, responseStatus: existing.responseStatus };
    }
    if (existing.status === 'processing' && existing.lockedUntil && existing.lockedUntil > input.now) {
      throw new ConflictException('IDEMPOTENCY_REQUEST_IN_PROGRESS');
    }
    // Lease vencido o intento fallido: reclamo ATÓMICO. Si otro proceso lo recuperó un instante
    // antes, para este llamador la clave está en curso; no hay dos dueños.
    const lease = await this.claims.reclaimExpired(existing, input.now);
    if (!lease) throw new ConflictException('IDEMPOTENCY_REQUEST_IN_PROGRESS');
    return { mode: 'execute', lease, policy };
  }

  async claimIdempotency(input: {
    tenantScope: string;
    actorType: string | null;
    actorId: string | null;
    idempotencyKey: string;
    scope: string;
    request: RequestShape;
    now: Date;
  }): Promise<IdempotencyLookupResult> {
    const where = { tenantScope: input.tenantScope, scope: input.scope, idempotencyKey: input.idempotencyKey };
    const existing = await this.idempotencyModel.findOne({ where });

    if (existing) {
      return this.claimExisting(existing, input);
    }

    const ownerToken = newOwnerToken();
    try {
      const record = await this.idempotencyModel.create({
        tenantScope: input.tenantScope,
        actorType: input.actorType,
        actorId: input.actorId,
        idempotencyKey: input.idempotencyKey,
        scope: input.scope,
        requestHash: fingerprintRequest(input.request, this.secret),
        status: 'processing',
        responseStatus: null,
        responseBodyJson: null,
        lockedUntil: new Date(input.now.getTime() + LEASE_DURATION_MS),
        ownerToken,
        completedAt: null,
        createdAtValue: input.now,
        updatedAtValue: input.now,
      });
      return { mode: 'execute', lease: { record, ownerToken }, policy: operationPolicy(input.scope) };
    } catch (error) {
      // Carrera: dos requests con la misma idempotencyKey pasaron el `findOne` de arriba antes
      // de que cualquiera commiteara su `create`. El índice único (`ux_idempotency_scope_key`)
      // rechaza el segundo insert — en vez de dejar que ese error suba como un 500 genérico, se
      // trata exactamente igual que si el `findOne` inicial ya la hubiera encontrado.
      if (!(error instanceof UniqueConstraintError)) throw error;
      const raced = await this.idempotencyModel.findOne({ where });
      if (!raced) throw error;
      return this.claimExisting(raced, input);
    }
  }

  /**
   * Cierra la concesión con el resultado. Si el testigo ya no es el vigente (otro proceso recuperó el
   * lease mientras este ejecutaba), el resultado de ESTE proceso no se guarda: quien llamó recibe su
   * respuesta —la mutación ocurrió— pero el registro sigue perteneciendo al dueño actual. Se deja
   * rastro porque es la señal de un handler que tardó más que el lease (AT-009).
   */
  async completeIdempotency(lease: IdempotencyLease, responseStatus: number, responseBody: unknown): Promise<void> {
    const now = new Date();
    const policy = operationPolicy(lease.record.scope);
    const responseBodyJson = policy.storeResponse ? (redactSensitiveObject(responseBody) as Record<string, unknown>) : null;
    const owned = await this.claims.complete(lease, { responseStatus, responseBodyJson, now });
    if (!owned)
      this.logger.warn(`IDEMPOTENCY_LEASE_LOST scope=${lease.record.scope} id=${lease.record.id}: otro proceso recuperó la clave.`);
  }

  async failIdempotency(lease: IdempotencyLease): Promise<void> {
    const owned = await this.claims.fail(lease, new Date());
    if (!owned)
      this.logger.warn(`IDEMPOTENCY_LEASE_LOST scope=${lease.record.scope} id=${lease.record.id}: fallo de un dueño anterior, ignorado.`);
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
      // AT-037: telemetría HTTP, no hecho de dominio. La marca permite distinguirla en cualquier lector.
      eventFamily: 'api_audit',
      producer: 'http-audit',
      schemaVersion: 1,
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
