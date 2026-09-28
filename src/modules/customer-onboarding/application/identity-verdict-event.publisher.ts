/**
 * @file Publicador de un evento de dominio por el outbox transaccional de la plataforma.
 * @business Avisa al cliente el veredicto de su identidad: sin esto una persona aprobaba o rechazaba el expediente y el cliente no se enteraba.
 * @system escribe `kyc.approved` / `kyc.rejected` con `SequelizeOutboxWriter`, en la MISMA transacción que resuelve el intento.
 */
import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import type { Transaction } from 'sequelize';
import { OutboxEventModel } from '../../../database/models/index.js';
import { SequelizeOutboxWriter } from '../../../platform/events/sequelize-outbox-writer.js';

/**
 * Qué camino cerró la identidad. `internal_decision` es la decisión en bloque del portal admin;
 * `manual_review` es `IdentityManualReviewOutcomeService`, al que llegan el callback del Motor y la ruta
 * `POST /customer-onboarding/:customerId/identity-manual-review`.
 */
export type IdentityVerdictSource = 'internal_decision' | 'manual_review';

export type IdentityVerdict = {
  tenantId: string;
  customerId: string;
  attemptId: string;
  verdict: 'verified' | 'rejected';
  source: IdentityVerdictSource;
  reasonCode: string | null;
  decidedAt: Date;
};

/**
 * Hallazgo A8 (plan de procesos, 2026-09-26): `kyc.approved` y `kyc.rejected` estaban registrados y
 * con canales (`notification-rules.service.ts`), pero ningún código los emitía.
 *
 * Se publican donde la identidad queda resuelta DE FORMA DEFINITIVA por una persona: la decisión
 * interna (`POST /operations/customers/:id/identity-verification/decision`) y el servicio común de la
 * revisión manual (`IdentityManualReviewOutcomeService`: callback del Motor
 * `POST /internal/identity/manual-review-callback` y la ruta de aplicación manual). La decisión interna
 * rechaza con 409 un intento delegado al Motor, y la clave por intento cubre el resto: un mismo intento
 * no avisa dos veces el mismo veredicto.
 *
 * El veredicto AUTOMÁTICO (el Motor decide en el acto por el canal móvil, o el proveedor por SEGIP) no
 * pasa por aquí: la app lo ve al consultar el estado del intento.
 *
 * - Agregado `customer` con el id del cliente, y `customerId` en el payload: es lo que el orquestador de
 *   notificaciones usa para encontrar al destinatario.
 * - Por el escritor de la PLATAFORMA (`SequelizeOutboxWriter`), no por `EventsService`: el alta no puede
 *   depender del módulo `events` (fronteras AT-011), y el escritor valida el sobre igual.
 * - Dentro de la transacción del veredicto: si ésta se revierte, el aviso nunca existió.
 */
@Injectable()
export class IdentityVerdictEventPublisher {
  constructor(@InjectModel(OutboxEventModel) private readonly outboxModel: typeof OutboxEventModel) {}

  async publish(verdict: IdentityVerdict, transaction: Transaction): Promise<void> {
    const eventCode = verdict.verdict === 'verified' ? 'kyc.approved' : 'kyc.rejected';
    const dedupKey = `identity-verdict:${verdict.attemptId}`;

    /*
     * `ux_outbox_tenant_event_idempotency_key` es único: un callback del Motor reenviado chocaría con
     * él y revertiría la transacción entera —el veredicto incluido—. Se mira antes y, si ya está, no se
     * vuelve a escribir.
     */
    const existing = await this.outboxModel.findOne({
      where: { tenantId: verdict.tenantId, eventCode, idempotencyKey: dedupKey },
      transaction,
    });
    if (existing) return;

    await new SequelizeOutboxWriter(this.outboxModel, transaction).append({
      type: eventCode,
      scope: { kind: 'tenant', tenantId: verdict.tenantId },
      aggregate: { type: 'customer', id: verdict.customerId },
      payload: {
        customerId: verdict.customerId,
        identityVerificationAttemptId: verdict.attemptId,
        verdict: verdict.verdict,
        source: verdict.source,
        reasonCode: verdict.reasonCode,
        decidedAt: verdict.decidedAt.toISOString(),
      },
      producer: 'customer_onboarding',
      dedupKey,
      priority: 10,
    });
  }
}
