/**
 * @file Modelo ORM: mapea una tabla y su contrato tipado.
 * @business Esta pieza preserva la fuente de verdad y la evidencia histórica que soportan decisiones y cumplimiento.
 * @system define models para evolucionar, mapear, sembrar o consultar PostgreSQL de forma controlada.
 */
import { Column, DataType, Model, Table } from 'sequelize-typescript';
import { atlasSchemaFor } from '../domain-schemas.js';

/** Estados de una reserva: viva, convertida en préstamo, o devuelta al cupo. */
export type ExposureReservationStatus = 'reserved' | 'consumed' | 'released';

/**
 * El cupo de la línea que una solicitud aprobada tiene apartado (P-11).
 *
 * Una reserva `reserved` cuenta contra el límite mientras no venza; `consumed` es el cupo que ya es
 * préstamo (y a partir de ahí lo cuenta el saldo del préstamo, no la reserva); `released` vuelve al
 * cupo. La transición a `released` es un `UPDATE … WHERE status = 'reserved'`: sólo una de dos
 * cancelaciones simultáneas la hace.
 */
@Table({ tableName: 'credit_exposure_reservations', schema: atlasSchemaFor('credit_exposure_reservations'), timestamps: false })
export class CreditExposureReservationModel extends Model {
  @Column({ field: '_id', type: DataType.BIGINT, primaryKey: true, autoIncrement: true, allowNull: false })
  declare id: string;

  @Column({ field: '_tenant_id', type: DataType.BIGINT, allowNull: false })
  declare tenantId: string;

  @Column({ field: 'customer_id', type: DataType.BIGINT, allowNull: false })
  declare customerId: string;

  @Column({ field: 'credit_application_id', type: DataType.BIGINT, allowNull: false })
  declare creditApplicationId: string;

  @Column({ field: 'amount', type: DataType.DECIMAL(18, 2), allowNull: false })
  declare amount: string;

  @Column({ field: 'currency_code', type: DataType.STRING(3), allowNull: false })
  declare currencyCode: string;

  @Column({ field: 'status', type: DataType.STRING(20), allowNull: false })
  declare status: ExposureReservationStatus;

  /** Hasta cuándo vale la decisión que la respalda. Vencida, no cuenta y no se puede consumir. */
  @Column({ field: 'expires_at', type: DataType.DATE, allowNull: false })
  declare expiresAt: Date;

  @Column({ field: 'loan_id', type: DataType.BIGINT })
  declare loanId: string | null;

  @Column({ field: 'release_reason', type: DataType.STRING(120) })
  declare releaseReason: string | null;

  @Column({ field: 'reserved_at', type: DataType.DATE, allowNull: false })
  declare reservedAt: Date;

  @Column({ field: 'consumed_at', type: DataType.DATE })
  declare consumedAt: Date | null;

  @Column({ field: 'released_at', type: DataType.DATE })
  declare releasedAt: Date | null;

  @Column({ field: '_created_at', type: DataType.DATE, allowNull: false })
  declare createdAtValue: Date;

  @Column({ field: '_updated_at', type: DataType.DATE })
  declare updatedAtValue: Date | null;
}
