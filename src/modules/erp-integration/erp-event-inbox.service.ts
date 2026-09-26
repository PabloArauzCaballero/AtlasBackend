/**
 * @file Servicio de aplicación: aplica UNA vez cada evento del ERP y responde qué hizo con él.
 * @business El ERP entrega «al menos una vez» (reintentos, caída entre ACK y marca, replay). Diez
 *   entregas de la misma cobertura liquidada dejan UNA proyección; una versión vieja no pisa una nueva;
 *   un tópico que Core no usa se acusa sin efecto y queda anotado.
 * @system Una transacción: recibo en `external_event_inbox` con unicidad (productor, clave) + avance
 *   condicional de la versión del agregado + efecto. Si el efecto falla se revierte también el recibo y
 *   el reintento vuelve a aplicarlo. El 2xx del controlador sale DESPUÉS del commit: ése es el ACK.
 */
import { Injectable, UnprocessableEntityException } from '@nestjs/common';
import { InjectConnection } from '@nestjs/sequelize';
import { QueryTypes, type Transaction } from 'sequelize';
import { Sequelize } from 'sequelize-typescript';
import { atlasSchemaFor } from '../../database/domain-schemas.js';
import { InstallmentCoverageProjection } from './installment-coverage.projection.js';
import { PartnerMdrProjection } from './partner-mdr.projection.js';
import {
  CONSUMED_ERP_TOPICS,
  isConsumedErpTopic,
  type CoverageSettledPayload,
  type IntegrationEnvelope,
  type MdrUpdatedPayload,
  type RecoveryMovementPayload,
} from './integration-envelope.schemas.js';

export type InboxOutcome = 'APPLIED' | 'IGNORED' | 'STALE' | 'UNLINKED' | 'DUPLICATE';

const INBOX = `${atlasSchemaFor('external_event_inbox')}.external_event_inbox`;
const VERSIONS = `${atlasSchemaFor('external_aggregate_versions')}.external_aggregate_versions`;

type ParsedEvent =
  | { kind: 'ignored' }
  | { kind: 'coverage-settled'; payload: CoverageSettledPayload }
  | { kind: 'recovery-movement'; payload: RecoveryMovementPayload }
  | { kind: 'mdr-updated'; payload: MdrUpdatedPayload };

@Injectable()
export class ErpEventInboxService {
  private readonly projection: InstallmentCoverageProjection;
  private readonly mdrProjection: PartnerMdrProjection;

  constructor(@InjectConnection() private readonly sequelize: Sequelize) {
    this.projection = new InstallmentCoverageProjection(sequelize);
    this.mdrProjection = new PartnerMdrProjection(sequelize);
  }

  async receive(envelope: IntegrationEnvelope): Promise<{ outcome: InboxOutcome }> {
    if (envelope.producer !== 'atlas-erp' || envelope.spec !== 'atlas.erp.outbox/1') {
      throw new UnprocessableEntityException({ code: 'UNEXPECTED_PRODUCER', message: 'Este receptor sólo acepta sobres del ERP.' });
    }
    // Antes de abrir la transacción: un payload que no cumple el contrato es un 422 definitivo.
    const parsed = parseEvent(envelope);
    // `mdr-updated` no lleva `coreRef` (T-10): su tenant sale del sobre, no del payload. Sin él no
    // hay con qué escoger tenant al proyectar, así que la fila queda auditada con `_tenant_id` nulo y
    // el efecto (abajo) la trata como UNLINKED — nunca escribe a ciegas en el tenant equivocado.
    const tenantId =
      parsed.kind === 'ignored'
        ? null
        : parsed.kind === 'mdr-updated'
          ? (envelope.tenantId ?? null)
          : (parsed.payload.coreRef?.tenantId ?? null);

    return this.sequelize.transaction(async (transaction) => {
      const recorded = await this.sequelize.query<{ id: string }>(
        `INSERT INTO ${INBOX}
           (producer, event_key, topic, schema_version, aggregate_type, aggregate_id, aggregate_version,
            outcome, _tenant_id, payload, occurred_at)
         VALUES ($producer, $eventKey, $topic, $schemaVersion, $aggregateType, $aggregateId, $aggregateVersion,
                 'APPLIED', $tenantId, $payload::jsonb, $occurredAt)
         ON CONFLICT (producer, event_key) DO NOTHING
         RETURNING _id AS id`,
        {
          type: QueryTypes.SELECT,
          transaction,
          bind: {
            producer: envelope.producer,
            eventKey: envelope.eventKey,
            topic: envelope.topic,
            schemaVersion: envelope.schemaVersion,
            aggregateType: envelope.aggregate.type,
            aggregateId: envelope.aggregate.id,
            aggregateVersion: envelope.aggregate.version,
            tenantId,
            payload: JSON.stringify(envelope.payload),
            occurredAt: envelope.occurredAt,
          },
        },
      );
      if (recorded.length === 0) return { outcome: 'DUPLICATE' as const };

      if (parsed.kind === 'ignored') return this.settle(envelope, 'IGNORED', transaction);
      if (!(await this.advanceVersion(envelope, transaction))) return this.settle(envelope, 'STALE', transaction);

      const linked = await this.applyEffect(parsed, envelope, tenantId, transaction);
      return linked ? { outcome: 'APPLIED' as const } : this.settle(envelope, 'UNLINKED', transaction);
    });
  }

  /** El efecto de cada tipo de evento YA parseado. Devuelve si quedó ligado a algo que existe en Core. */
  private applyEffect(
    parsed: Exclude<ParsedEvent, { kind: 'ignored' }>,
    envelope: IntegrationEnvelope,
    tenantId: string | null,
    transaction: Transaction,
  ): Promise<boolean> {
    if (parsed.kind === 'coverage-settled') return this.projection.applySettlement(envelope.eventKey, parsed.payload, transaction);
    if (parsed.kind === 'mdr-updated') return this.mdrProjection.applyMdrUpdate(parsed.payload, tenantId, transaction);
    return this.projection.applyRecoveryMovement(parsed.payload, envelope.aggregate.version, transaction);
  }

  /** Avanza la última versión del agregado sólo si la entrante es MAYOR. Devuelve si avanzó. */
  private async advanceVersion(envelope: IntegrationEnvelope, transaction: Transaction): Promise<boolean> {
    const advanced = await this.sequelize.query<{ v: string }>(
      `INSERT INTO ${VERSIONS} (producer, aggregate_type, aggregate_id, last_version)
       VALUES ($producer, $type, $id, $version)
       ON CONFLICT (producer, aggregate_type, aggregate_id) DO UPDATE
         SET last_version = EXCLUDED.last_version, _updated_at = now()
         WHERE ${VERSIONS}.last_version < EXCLUDED.last_version
       RETURNING last_version::text AS v`,
      {
        type: QueryTypes.SELECT,
        transaction,
        bind: {
          producer: envelope.producer,
          type: envelope.aggregate.type,
          id: envelope.aggregate.id,
          version: envelope.aggregate.version,
        },
      },
    );
    return advanced.length > 0;
  }

  private async settle(
    envelope: IntegrationEnvelope,
    outcome: Exclude<InboxOutcome, 'APPLIED' | 'DUPLICATE'>,
    transaction: Transaction,
  ): Promise<{ outcome: InboxOutcome }> {
    await this.sequelize.query(`UPDATE ${INBOX} SET outcome = $outcome WHERE producer = $producer AND event_key = $eventKey`, {
      transaction,
      bind: { outcome, producer: envelope.producer, eventKey: envelope.eventKey },
    });
    return { outcome };
  }
}

function parseEvent(envelope: IntegrationEnvelope): ParsedEvent {
  if (!isConsumedErpTopic(envelope.topic)) return { kind: 'ignored' };
  const contract = CONSUMED_ERP_TOPICS[envelope.topic];
  if (envelope.schemaVersion !== contract.schemaVersion) {
    throw new UnprocessableEntityException({
      code: 'UNKNOWN_SCHEMA_VERSION',
      message: `${envelope.topic} v${envelope.schemaVersion}: Core entiende la v${contract.schemaVersion}.`,
    });
  }
  const result = contract.payload.safeParse(envelope.payload);
  if (!result.success) {
    throw new UnprocessableEntityException({
      code: 'PAYLOAD_CONTRACT_VIOLATION',
      message: `${envelope.topic}: el payload no cumple atlas-integration-v1.`,
      issues: result.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).slice(0, 10),
    });
  }
  // Despacho explícito por tópico y no un binario: con sólo dos ramas, un tópico nuevo caía por
  // omisión en la rama equivocada sin que el tipo lo avisara (T-10 lo habría clasificado como
  // `recovery-movement` y `applyRecoveryMovement` habría leído campos que su payload no tiene).
  switch (envelope.topic) {
    case 'b2b.coverage.settled':
      return { kind: 'coverage-settled', payload: result.data as CoverageSettledPayload };
    case 'merchant.mdr.updated':
      return { kind: 'mdr-updated', payload: result.data as MdrUpdatedPayload };
    default:
      return { kind: 'recovery-movement', payload: result.data as RecoveryMovementPayload };
  }
}
