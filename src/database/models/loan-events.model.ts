/**
 * @file Modelo ORM: mapea una tabla y su contrato tipado.
 * @business Esta pieza preserva la fuente de verdad y la evidencia histórica que soportan decisiones y cumplimiento.
 * @system define models para evolucionar, mapear, sembrar o consultar PostgreSQL de forma controlada.
 */
import { Column, DataType, Model, Table } from 'sequelize-typescript';
import { atlasSchemaFor } from '../domain-schemas.js';

/** Historial append-only del préstamo, mismo criterio que el resto del dominio de crédito. */
@Table({ tableName: 'loan_events', schema: atlasSchemaFor('loan_events'), timestamps: false })
export class LoanEventModel extends Model {
  @Column({ field: '_id', type: DataType.BIGINT, primaryKey: true, autoIncrement: true, allowNull: false })
  declare id: string;

  @Column({ field: '_tenant_id', type: DataType.BIGINT, allowNull: false })
  declare tenantId: string;

  @Column({ field: 'loan_id', type: DataType.BIGINT, allowNull: false })
  declare loanId: string;

  @Column({ field: 'event_type', type: DataType.STRING(40), allowNull: false })
  declare eventType: string;

  @Column({ field: 'previous_status', type: DataType.STRING(30) })
  declare previousStatus: string | null;

  @Column({ field: 'new_status', type: DataType.STRING(30) })
  declare newStatus: string | null;

  @Column({ field: 'actor_type', type: DataType.STRING(40), allowNull: false })
  declare actorType: string;

  @Column({ field: 'actor_internal_user_id', type: DataType.BIGINT })
  declare actorInternalUserId: string | null;

  @Column({ field: 'reason_code', type: DataType.STRING(120) })
  declare reasonCode: string | null;

  @Column({ field: 'payload_json', type: DataType.JSONB })
  declare payloadJson: unknown;

  @Column({ field: 'notes', type: DataType.TEXT })
  declare notes: string | null;

  @Column({ field: 'happened_at', type: DataType.DATE, allowNull: false })
  declare happenedAt: Date;

  @Column({ field: '_created_at', type: DataType.DATE, allowNull: false })
  declare createdAtValue: Date;
}
