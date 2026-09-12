/**
 * @file Almacén de concesiones de idempotencia: reclamo atómico y cierre con fencing (AT-009).
 * @business Dos procesos que encuentran el mismo lease vencido no pueden quedar autorizados a la vez;
 *   y el que perdió no puede, al despertar, pisar el resultado del que ganó.
 * @system Cada transición es UNA actualización condicional en PostgreSQL: `UPDATE … WHERE` con el
 *   estado esperado. Bajo READ COMMITTED el segundo `UPDATE` espera el bloqueo de fila del primero,
 *   re-evalúa el `WHERE` sobre la fila ya cambiada y no encaja: afecta 0 filas. Ese «0 filas» es la
 *   señal, no una lectura previa que puede quedar vieja entre el `SELECT` y el `save()`.
 */
import { randomBytes } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { Op } from 'sequelize';
import { IdempotencyKeyModel } from '../../../database/models/index.js';

/** Lo que recibe quien ejecuta: la fila y el testigo con el que podrá cerrarla. */
export type IdempotencyLease = { record: IdempotencyKeyModel; ownerToken: string };

export const LEASE_DURATION_MS = 5 * 60_000;

export function newOwnerToken(): string {
  return randomBytes(16).toString('hex');
}

@Injectable()
export class IdempotencyClaimStore {
  constructor(@InjectModel(IdempotencyKeyModel) private readonly model: typeof IdempotencyKeyModel) {}

  /**
   * Intenta apropiarse de un registro cuyo lease venció (o que quedó en `failed`). Devuelve la
   * concesión si ESTE proceso ganó; `null` si otro se adelantó. Nunca lanza por perder la carrera.
   */
  async reclaimExpired(existing: IdempotencyKeyModel, now: Date): Promise<IdempotencyLease | null> {
    const ownerToken = newOwnerToken();
    const [affected] = await this.model.update(
      { status: 'processing', ownerToken, lockedUntil: new Date(now.getTime() + LEASE_DURATION_MS), updatedAtValue: now },
      {
        where: {
          id: existing.id,
          [Op.or]: [
            { status: 'failed' },
            { status: 'processing', lockedUntil: null },
            { status: 'processing', lockedUntil: { [Op.lte]: now } },
          ],
        },
      },
    );
    if (affected !== 1) return null;
    existing.status = 'processing';
    existing.ownerToken = ownerToken;
    existing.lockedUntil = new Date(now.getTime() + LEASE_DURATION_MS);
    return { record: existing, ownerToken };
  }

  /**
   * Cierra la concesión con el resultado. Devuelve `false` si el testigo ya no es el vigente: otro
   * proceso recuperó el lease mientras este ejecutaba, y su resultado —no este— es el que vale.
   */
  async complete(
    lease: IdempotencyLease,
    values: { responseStatus: number; responseBodyJson: Record<string, unknown> | null; now: Date },
  ): Promise<boolean> {
    const [affected] = await this.model.update(
      {
        status: 'completed',
        responseStatus: values.responseStatus,
        responseBodyJson: values.responseBodyJson,
        lockedUntil: null,
        completedAt: values.now,
        updatedAtValue: values.now,
      },
      { where: { id: lease.record.id, ownerToken: lease.ownerToken, status: 'processing' } },
    );
    return affected === 1;
  }

  /** Libera la concesión para que un reintento pueda reclamarla. Mismo fencing que `complete`. */
  async fail(lease: IdempotencyLease, now: Date): Promise<boolean> {
    const [affected] = await this.model.update(
      { status: 'failed', lockedUntil: null, updatedAtValue: now },
      { where: { id: lease.record.id, ownerToken: lease.ownerToken, status: 'processing' } },
    );
    return affected === 1;
  }
}
