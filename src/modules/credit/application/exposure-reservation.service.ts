/**
 * @file Servicio de aplicación: reserva, consume y libera el cupo de la línea de crédito (P-11, B15).
 * @business Dos concesiones simultáneas no pueden repartirse el mismo cupo: como mucho una cabe.
 * @system serializa por el cerrojo de la fila del cliente y deja escrita la reserva que la concesión consume.
 */
import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/sequelize';
import { Op, QueryTypes, type Transaction } from 'sequelize';
import { Sequelize } from 'sequelize-typescript';
import { atlasSchemaFor } from '../../../database/domain-schemas.js';
import { CreditExposureReservationModel } from '../../../database/models/index.js';

/** Estados del préstamo cuyo saldo sigue siendo exposición viva del cliente. */
const LIVE_LOAN_STATUSES = ['active', 'pending_disbursement'];

type ExposureSnapshot = {
  approved_limit: string | null;
  currency_code: string | null;
  loans_exposure: string;
  reserved_exposure: string;
  fits: boolean | null;
};

/**
 * Hasta cuándo sirve una decisión para conceder. Sin fecha de decisión no hay vigencia que
 * demostrar: se trata como ya vencida (fallar cerrado), nunca como eterna.
 */
export function decisionExpiresAt(decidedAt: Date | null | undefined, validityHours: number): Date {
  if (!decidedAt) return new Date(0);
  return new Date(decidedAt.getTime() + validityHours * 3_600_000);
}

export type ReserveExposureInput = {
  tenantId: string;
  customerId: string;
  applicationId: string;
  /** Importe como texto decimal (`NUMERIC`): la comparación se hace en PostgreSQL, sin flotantes. */
  amount: string;
  currencyCode: string;
  /** Vencimiento de la decisión que respalda la reserva. */
  expiresAt: Date;
  now: Date;
};

/**
 * El cupo de la línea, como recurso que se reserva y no como suma que se lee.
 *
 * ## Por qué no basta leer la suma
 *
 * `credit_lines.approved_limit` decía cuánto podía deber cada cliente y el desembolso no lo miraba.
 * Mirarlo con un `SUM` tampoco basta: dos desembolsos concurrentes de 80 sobre 900 de deuda y 1.000
 * de límite leen los dos 900, los dos ven que caben, y el cliente termina debiendo 1.060. Aquí todo
 * lo que mueve el cupo toma primero el cerrojo de la fila del CLIENTE (`FOR UPDATE`, el mismo que ya
 * ordena la admisión, AT-007), así que la segunda lectura ve la reserva de la primera.
 *
 * ## Fallar cerrado
 *
 * Sin línea vigente, o con la línea en otra moneda, no se concede: un límite desconocido no es un
 * límite infinito. La reserva lleva el vencimiento de la decisión; vencida no cuenta ni se consume,
 * y la concesión tiene que volver a reservar —revalidar— bajo el cerrojo.
 */
@Injectable()
export class ExposureReservationService {
  constructor(
    @InjectModel(CreditExposureReservationModel) private readonly reservations: typeof CreditExposureReservationModel,
    @InjectConnection() private readonly sequelize: Sequelize,
  ) {}

  /**
   * Reserva el cupo de una solicitud, o devuelve la reserva viva que ya tiene.
   *
   * Idempotente por solicitud: reintentar la misma concesión no aparta el cupo dos veces (lo impide
   * además el índice único parcial). Una reserva vencida de la misma solicitud se libera primero, y
   * la nueva se evalúa contra el límite de HOY.
   */
  async reserve(input: ReserveExposureInput, transaction: Transaction): Promise<CreditExposureReservationModel> {
    await this.lockCustomer(input.tenantId, input.customerId, transaction);
    if (input.expiresAt.getTime() <= input.now.getTime()) throw new ConflictException('CREDIT_DECISION_EXPIRED');

    const existing = await this.reservations.findOne({
      where: { tenantId: input.tenantId, creditApplicationId: input.applicationId, status: { [Op.in]: ['reserved', 'consumed'] } },
      transaction,
    });
    if (existing?.status === 'consumed') throw new ConflictException('CREDIT_EXPOSURE_ALREADY_CONSUMED');
    if (existing && existing.expiresAt.getTime() > input.now.getTime()) return existing;
    if (existing) await this.releaseRow(existing, 'expired', input.now, transaction);

    const snapshot = await this.snapshot(input, transaction);
    if (snapshot.approved_limit === null) throw new ConflictException('CREDIT_LIMIT_UNKNOWN');
    if (snapshot.currency_code !== input.currencyCode) throw new ConflictException('CREDIT_LIMIT_CURRENCY_MISMATCH');
    if (snapshot.fits !== true) throw new ConflictException('CREDIT_EXPOSURE_LIMIT_EXCEEDED');

    return this.reservations.create(
      {
        tenantId: input.tenantId,
        customerId: input.customerId,
        creditApplicationId: input.applicationId,
        amount: input.amount,
        currencyCode: input.currencyCode,
        status: 'reserved',
        expiresAt: input.expiresAt,
        loanId: null,
        releaseReason: null,
        reservedAt: input.now,
        createdAtValue: input.now,
        updatedAtValue: input.now,
      } as never,
      { transaction },
    );
  }

  /**
   * Convierte la reserva en préstamo. Condición atómica: sólo una reserva viva y NO vencida.
   *
   * Desde aquí el cupo lo cuenta el saldo del préstamo (`outstanding_principal`), no la reserva: por
   * eso `consumed` deja de sumarse en `snapshot`.
   */
  async consume(input: { tenantId: string; applicationId: string; loanId: string; now: Date }, transaction: Transaction): Promise<void> {
    const [updated] = await this.reservations.update(
      { status: 'consumed', loanId: input.loanId, consumedAt: input.now, updatedAtValue: input.now },
      {
        where: {
          tenantId: input.tenantId,
          creditApplicationId: input.applicationId,
          status: 'reserved',
          expiresAt: { [Op.gt]: input.now },
        },
        transaction,
      },
    );
    if (updated !== 1) throw new ConflictException('CREDIT_EXPOSURE_RESERVATION_NOT_AVAILABLE');
  }

  /**
   * Devuelve el cupo de una solicitud que no se va a conceder. Una sola vez.
   *
   * `UPDATE … WHERE status = 'reserved'`: de dos cancelaciones simultáneas, la base deja pasar a una
   * y la otra encuentra cero filas. Por eso responde `released: false` en vez de fallar: cancelar lo
   * ya cancelado no es un error, pero tampoco puede devolver el cupo dos veces.
   */
  async release(
    input: { tenantId: string; applicationId: string; reason: string; now: Date },
    transaction?: Transaction,
  ): Promise<{ released: boolean }> {
    const [updated] = await this.reservations.update(
      { status: 'released', releaseReason: input.reason.slice(0, 120), releasedAt: input.now, updatedAtValue: input.now },
      { where: { tenantId: input.tenantId, creditApplicationId: input.applicationId, status: 'reserved' }, transaction },
    );
    return { released: updated === 1 };
  }

  private async releaseRow(row: CreditExposureReservationModel, reason: string, now: Date, transaction: Transaction): Promise<void> {
    await this.reservations.update(
      { status: 'released', releaseReason: reason, releasedAt: now, updatedAtValue: now },
      { where: { id: row.id, status: 'reserved' }, transaction },
    );
  }

  /** El cerrojo que ordena todo lo que toca el cupo del cliente. */
  private async lockCustomer(tenantId: string, customerId: string, transaction: Transaction): Promise<void> {
    const rows = await this.sequelize.query(
      `SELECT _id FROM ${atlasSchemaFor('customers')}.customers WHERE _id = $customerId AND _tenant_id = $tenantId FOR UPDATE`,
      { type: QueryTypes.SELECT, bind: { tenantId, customerId }, transaction },
    );
    if (rows.length === 0) throw new NotFoundException('CUSTOMER_NOT_FOUND');
  }

  /**
   * Límite vigente, exposición viva y si el importe cabe, en UNA consulta y en `NUMERIC`.
   *
   * Exposición = saldo de capital de los préstamos vivos + reservas vivas y no vencidas de OTRAS
   * solicitudes. La comparación la hace PostgreSQL: el dinero no pasa por un `number` de JavaScript.
   */
  private async snapshot(input: ReserveExposureInput, transaction: Transaction): Promise<ExposureSnapshot> {
    const credit = atlasSchemaFor('credit_lines');
    const rows = await this.sequelize.query<ExposureSnapshot>(
      `WITH line AS (
         SELECT approved_limit, currency_code FROM ${credit}.credit_lines
          WHERE _tenant_id = $tenantId AND customer_id = $customerId AND valid_until IS NULL AND _deleted = false
          ORDER BY valid_from DESC, _id DESC LIMIT 1
       ), loans AS (
         SELECT COALESCE(SUM(outstanding_principal), 0) AS total FROM ${atlasSchemaFor('loans')}.loans
          WHERE _tenant_id = $tenantId AND customer_id = $customerId AND _deleted = false AND status = ANY($liveStatuses)
       ), reserved AS (
         SELECT COALESCE(SUM(amount), 0) AS total FROM ${atlasSchemaFor('credit_exposure_reservations')}.credit_exposure_reservations
          WHERE _tenant_id = $tenantId AND customer_id = $customerId AND status = 'reserved'
            AND expires_at > $now AND credit_application_id <> $applicationId
       )
       SELECT line.approved_limit::text AS approved_limit, line.currency_code,
              loans.total::text AS loans_exposure, reserved.total::text AS reserved_exposure,
              (line.approved_limit - loans.total - reserved.total - $amount::numeric) >= 0 AS fits
         FROM loans CROSS JOIN reserved LEFT JOIN line ON true`,
      {
        type: QueryTypes.SELECT,
        bind: {
          tenantId: input.tenantId,
          customerId: input.customerId,
          applicationId: input.applicationId,
          amount: input.amount,
          now: input.now,
          liveStatuses: LIVE_LOAN_STATUSES,
        },
        transaction,
      },
    );
    return rows[0] ?? { approved_limit: null, currency_code: null, loans_exposure: '0', reserved_exposure: '0', fits: null };
  }
}
