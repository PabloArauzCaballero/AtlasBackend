/**
 * @file Registro de escritor único por contexto (AT-059): quién es dueño y con qué época.
 * @business En cada momento un solo proceso escribe y confirma el trabajo de un contexto; un corte
 *   (monolito → piloto, o la vuelta) sube la época y deja cercado al escritor anterior aunque siga vivo.
 * @system Fila por contexto en `platform_ops.context_ownership`. `transfer` es un UPDATE condicional a la
 *   época esperada y, en la misma transacción, devuelve a `pending` los eventos en vuelo anulando su
 *   `owner_token` (el cierre tardío del escritor viejo no encuentra la fila). Sin caché: una lectura por lote.
 */
import { Injectable, Optional } from '@nestjs/common';
import { InjectConnection } from '@nestjs/sequelize';
import { QueryTypes } from 'sequelize';
import { Sequelize } from 'sequelize-typescript';

export type ContextOwnership = Readonly<{ context: string; owner: string; epoch: number; changedAt: Date; changedBy: string | null }>;

export type OwnershipTransfer = Readonly<{
  context: string;
  from: string;
  to: string;
  /** Época que el solicitante vio; si cambió, nadie transfiere dos veces. */
  expectedEpoch: number;
  changedBy: string;
  /** Devuelve a `pending` los eventos `processing` del outbox (drenado forzoso). Por defecto exige cola drenada. */
  requeueInFlight?: boolean;
}>;

export type TransferResult = Readonly<{ ownership: ContextOwnership; requeued: number }>;

export class OwnershipFencedError extends Error {
  constructor(
    readonly context: string,
    readonly expectedOwner: string,
    readonly actual: ContextOwnership | null,
  ) {
    super(`OWNERSHIP_FENCED: ${context} pertenece a ${actual?.owner ?? '(nadie)'} (época ${actual?.epoch ?? '-'}), no a ${expectedOwner}`);
  }
}

const TABLE = 'platform_ops.context_ownership';

@Injectable()
export class ContextOwnershipRegistry {
  constructor(@Optional() @InjectConnection() private readonly sequelize?: Sequelize) {}

  private get db(): Sequelize {
    if (!this.sequelize) throw new Error('CONTEXT_OWNERSHIP_UNAVAILABLE: sin conexión a la base.');
    return this.sequelize;
  }

  async current(context: string): Promise<ContextOwnership | null> {
    const rows = await this.db.query<{ context: string; owner: string; epoch: string; changed_at: Date; changed_by: string | null }>(
      `SELECT context, owner, epoch::text AS epoch, changed_at, changed_by FROM ${TABLE} WHERE context = $context`,
      { type: QueryTypes.SELECT, bind: { context } },
    );
    const row = rows[0];
    if (!row) return null;
    return Object.freeze({
      context: row.context,
      owner: row.owner,
      epoch: Number(row.epoch),
      changedAt: row.changed_at,
      changedBy: row.changed_by,
    });
  }

  /** Época vigente si `owner` es el dueño; lanza `OwnershipFencedError` si no lo es. */
  async assertOwner(context: string, owner: string): Promise<number> {
    const ownership = await this.current(context);
    if (!ownership || ownership.owner !== owner) throw new OwnershipFencedError(context, owner, ownership);
    return ownership.epoch;
  }

  async transfer(input: OwnershipTransfer): Promise<TransferResult> {
    return this.db.transaction(async (transaction) => {
      const locked = await this.db.query<{ owner: string; epoch: string }>(
        `SELECT owner, epoch::text AS epoch FROM ${TABLE} WHERE context = $context FOR UPDATE`,
        { type: QueryTypes.SELECT, bind: { context: input.context }, transaction },
      );
      const row = locked[0];
      if (!row) throw new Error(`OWNERSHIP_UNKNOWN_CONTEXT: ${input.context}`);
      if (row.owner !== input.from || Number(row.epoch) !== input.expectedEpoch) {
        throw new OwnershipFencedError(input.context, input.from, {
          context: input.context,
          owner: row.owner,
          epoch: Number(row.epoch),
          changedAt: new Date(),
          changedBy: null,
        });
      }
      const inFlight = await this.db.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM platform_ops.outbox_events WHERE status = 'processing' AND aggregate_type <> 'api_command'`,
        { type: QueryTypes.SELECT, transaction },
      );
      let requeued = 0;
      if (Number(inFlight[0]?.n ?? 0) > 0) {
        if (!input.requeueInFlight)
          throw new Error(`OWNERSHIP_QUEUE_NOT_DRAINED: ${inFlight[0].n} evento(s) en vuelo; drena o pide requeueInFlight.`);
        const [, affected] = await this.db.query(
          `UPDATE platform_ops.outbox_events SET status = 'pending', locked_at = NULL, locked_by = NULL, owner_token = NULL, _updated_at = now()
           WHERE status = 'processing' AND aggregate_type <> 'api_command'`,
          { type: QueryTypes.UPDATE, transaction },
        );
        requeued = affected;
      }
      const updated = await this.db.query<{ epoch: string; changed_at: Date }>(
        `UPDATE ${TABLE} SET owner = $to, epoch = epoch + 1, changed_by = $changedBy, changed_at = now()
         WHERE context = $context AND owner = $from AND epoch = $expectedEpoch RETURNING epoch::text AS epoch, changed_at`,
        {
          type: QueryTypes.SELECT,
          bind: { to: input.to, changedBy: input.changedBy, context: input.context, from: input.from, expectedEpoch: input.expectedEpoch },
          transaction,
        },
      );
      const next = updated[0];
      return Object.freeze({
        ownership: Object.freeze({
          context: input.context,
          owner: input.to,
          epoch: Number(next.epoch),
          changedAt: next.changed_at,
          changedBy: input.changedBy,
        }),
        requeued,
      });
    });
  }
}
