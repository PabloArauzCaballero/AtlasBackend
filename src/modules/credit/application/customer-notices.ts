/**
 * @file Los avisos al cliente que nacen del crédito: qué evento se escribe, con qué datos y adónde lleva.
 * @business «Cuando algo ya esté hecho, que le llegue un aviso» (Pablo, 2026-10-16): tu capacidad fue
 *   actualizada, leímos tu extracto, no pudimos usarlo, tu compra fue aprobada o no.
 * @system funciones puras que arman el `CustomerNotice` de cada hecho y un publicador que lo escribe
 *   en el outbox; la regla y la plantilla de cada código viven en `notifications/`.
 */
import { Injectable, Logger } from '@nestjs/common';
import { InjectConnection } from '@nestjs/sequelize';
import type { Transaction } from 'sequelize';
import { Sequelize } from 'sequelize-typescript';
import { OutboxEventModel } from '../../../database/models/index.js';
import { SequelizeOutboxWriter } from '../../../platform/events/sequelize-outbox-writer.js';

/**
 * Un aviso al cliente, listo para el outbox. El agregado es siempre el cliente: es lo que el orquestador de
 * notificaciones usa para encontrar al destinatario (con `customerId` en el payload).
 */
export type CustomerNotice = {
  tenantId: string;
  eventCode: string;
  customerId: string;
  idempotencyKey: string;
  payload: Record<string, unknown>;
};

/**
 * A qué pantalla de la app lleva tocar el aviso (bandeja y push). Rutas internas de expo-router: la app
 * las valida con `rutaDelAviso` antes de navegar, igual que el enlace de una campaña.
 */
export const DESTINO = {
  inicio: '/',
  extracto: '/extracto-bancario',
  compras: '/compras',
} as const;

/**
 * Lo que el payload lleva para el envío además del dato del hecho: `deepLink` (lo lee la bandeja),
 * `pushData.deepLink` (viaja al teléfono; `extraPushData` sólo deja pasar `pushData`) y `visible` (el push
 * se pinta aunque la app esté cerrada). Nada sensible va a `pushData`: se lee en claro en el teléfono.
 */
function destino(deepLink: string): Record<string, unknown> {
  return { deepLink, pushData: { deepLink }, visible: true };
}

/** «1.500»: miles con punto y sin decimales, como el cliente ve su línea en la app. */
export function formatoBolivianos(value: number): string {
  return Math.round(value)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

/**
 * El aviso de una línea que CAMBIÓ fuera de un extracto (recálculo periódico, mora, operaciones).
 *
 * Sin cambio, no hay aviso: el recálculo horario que deja la cifra igual no le dice nada nuevo a nadie, y
 * avisarlo cada hora convertiría la bandeja en ruido. El extracto avisa por su cuenta
 * (`bankStatementAppliedNotice`) con la misma cifra: aquí se omite para no mandar dos avisos del mismo hecho.
 */
export function creditLineNotice(input: {
  tenantId: string;
  customerId: string;
  creditLineId: string;
  trigger: string;
  previousLimit: number | null;
  newLimit: number;
}): CustomerNotice | null {
  if (input.trigger === 'bank_statement') return null;
  const previous = input.previousLimit;
  let eventCode: string;
  if (previous === null) {
    if (input.newLimit <= 0) return null;
    eventCode = 'credit_line.created';
  } else if (input.newLimit > previous) eventCode = 'credit_line.increased';
  else if (input.newLimit < previous) eventCode = 'credit_line.decreased';
  else return null;
  return {
    tenantId: input.tenantId,
    eventCode,
    customerId: input.customerId,
    idempotencyKey: `credit-line-${input.creditLineId}`,
    payload: {
      customerId: input.customerId,
      creditLineId: input.creditLineId,
      previousLimit: previous,
      newLimit: input.newLimit,
      newLimitText: formatoBolivianos(input.newLimit),
      trigger: input.trigger,
      ...destino(DESTINO.inicio),
    },
  };
}

export type BankStatementNoticeKind = 'applied' | 'line_held' | 'rejected' | 'in_review';

const BANK_STATEMENT_EVENT: Record<BankStatementNoticeKind, string> = {
  applied: 'bank_statement.applied',
  line_held: 'bank_statement.line_held',
  rejected: 'bank_statement.rejected',
  in_review: 'bank_statement.in_review',
};

/**
 * El aviso del extracto. Una sola clave por revisión y desenlace: el barrido que pasa otra vez por la misma
 * revisión (reintento, aviso del Motor y barrido a la vez) no repite el mensaje.
 */
export function bankStatementNotice(input: {
  kind: BankStatementNoticeKind;
  tenantId: string;
  customerId: string;
  reviewId: string;
  newLimit?: number | null;
  /** El motivo del rechazo, ya en lenguaje del cliente (`statement-rejection.ts`). */
  message?: string | null;
}): CustomerNotice {
  const payload: Record<string, unknown> = {
    customerId: input.customerId,
    reviewId: input.reviewId,
    ...destino(input.kind === 'applied' ? DESTINO.inicio : DESTINO.extracto),
  };
  if (input.newLimit !== undefined && input.newLimit !== null) {
    payload.newLimit = input.newLimit;
    payload.newLimitText = formatoBolivianos(input.newLimit);
  }
  if (input.message) payload.reason = input.message;
  return {
    tenantId: input.tenantId,
    eventCode: BANK_STATEMENT_EVENT[input.kind],
    customerId: input.customerId,
    idempotencyKey: `bank-statement-${input.reviewId}-${input.kind}`,
    payload,
  };
}

/**
 * El aviso de una solicitud de compra que decidió una PERSONA o la revisión del Motor. Las decisiones
 * automáticas no avisan: la persona está en la pantalla de la compra y la ve en el acto.
 */
export function creditApplicationNotice(input: {
  tenantId: string;
  customerId: string | null | undefined;
  applicationId: string;
  status: string;
}): CustomerNotice | null {
  if (!input.customerId) return null;
  const eventCode =
    input.status === 'approved' ? 'credit.application.approved' : input.status === 'rejected' ? 'credit.application.rejected' : null;
  if (!eventCode) return null;
  return {
    tenantId: input.tenantId,
    eventCode,
    customerId: String(input.customerId),
    idempotencyKey: `credit-application-${input.applicationId}-${input.status}`,
    payload: { customerId: String(input.customerId), applicationId: input.applicationId, ...destino(DESTINO.compras) },
  };
}

/**
 * Escribe el aviso en el outbox, por el escritor de la PLATAFORMA (`SequelizeOutboxWriter`): crédito no puede
 * depender del módulo `events` (fronteras de `check:architecture`), igual que el alta con `kyc.*`.
 *
 * - **Con transacción** va DENTRO del cambio que describe: si el cambio se revierte, el aviso nunca existió.
 * - **Sin transacción** (el extracto, que guarda en varios pasos) abre la suya, y un fallo del aviso NO deshace
 *   el desenlace ya guardado: se registra y el cliente lo ve igual en la app.
 * - **Una vez**: la clave de idempotencia es única por inquilino y evento. Se mira antes y la escritura va en un
 *   punto de guardado, para que una carrera con otro proceso no revierta la transacción del hecho.
 */
@Injectable()
export class CustomerNoticePublisher {
  private readonly logger = new Logger(CustomerNoticePublisher.name);

  constructor(@InjectConnection() private readonly sequelize: Sequelize) {}

  async publish(notice: CustomerNotice | null, options: { transaction?: Transaction } = {}): Promise<void> {
    if (!notice) return;
    if (options.transaction) {
      await this.write(notice, options.transaction);
      return;
    }
    try {
      await this.sequelize.transaction((transaction) => this.write(notice, transaction));
    } catch (error) {
      this.logger.error(`No se pudo escribir el aviso ${notice.eventCode} (${notice.idempotencyKey}): ${(error as Error).message}`);
    }
  }

  private async write(notice: CustomerNotice, transaction: Transaction): Promise<void> {
    const exists = () =>
      OutboxEventModel.findOne({
        where: { tenantId: notice.tenantId, eventCode: notice.eventCode, idempotencyKey: notice.idempotencyKey },
        transaction,
      });
    if (await exists()) return;
    try {
      await this.sequelize.transaction({ transaction }, (savepoint) =>
        new SequelizeOutboxWriter(OutboxEventModel, savepoint).append({
          type: notice.eventCode,
          scope: { kind: 'tenant', tenantId: notice.tenantId },
          aggregate: { type: 'customer', id: notice.customerId },
          payload: notice.payload,
          producer: 'credit',
          dedupKey: notice.idempotencyKey,
          priority: 20,
        }),
      );
    } catch (error) {
      if (await exists()) return;
      throw error;
    }
  }
}
