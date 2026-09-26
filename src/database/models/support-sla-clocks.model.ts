/**
 * @file Modelo Sequelize: proyección tipada de una tabla del esquema.
 * @business El reloj de cada compromiso del caso: cuándo vence responder, actualizar y resolver.
 * @system `support.support_sla_clocks`, un reloj por métrica, con pausas registradas y no implícitas.
 */
import { Column, DataType, Model, Table } from 'sequelize-typescript';
import { atlasSchemaFor } from '../domain-schemas.js';

/**
 * Una pausa que no queda escrita es un incumplimiento que desaparece.
 *
 * Por eso `pausedAt` y `totalPausedSeconds` son datos y no un efecto del estado: si el caso espera
 * al cliente, el reloj sólo se detiene cuando la POLÍTICA lo permite, y la detención queda con su
 * momento. Lo contrario permite ocultar cualquier retraso poniendo el caso "en espera".
 */
@Table({ tableName: 'support_sla_clocks', schema: atlasSchemaFor('support_sla_clocks'), timestamps: false })
export class SupportSlaClockModel extends Model {
  @Column({ field: '_id', type: DataType.BIGINT, primaryKey: true, autoIncrement: true, allowNull: false })
  declare id: string;

  @Column({ field: '_tenant_id', type: DataType.BIGINT, allowNull: false })
  declare tenantId: string;

  @Column({ field: 'case_id', type: DataType.BIGINT, allowNull: false })
  declare caseId: string;

  @Column({ field: 'metric_type', type: DataType.STRING(30), allowNull: false })
  declare metricType: string;

  @Column({ field: 'policy_version_id', type: DataType.BIGINT })
  declare policyVersionId: string | null;

  @Column({ field: 'started_at', type: DataType.DATE, allowNull: false })
  declare startedAt: Date;

  @Column({ field: 'target_at', type: DataType.DATE, allowNull: false })
  declare targetAt: Date;

  @Column({ field: 'paused_at', type: DataType.DATE })
  declare pausedAt: Date | null;

  @Column({ field: 'total_paused_seconds', type: DataType.INTEGER, allowNull: false })
  declare totalPausedSeconds: number;

  @Column({ field: 'satisfied_at', type: DataType.DATE })
  declare satisfiedAt: Date | null;

  @Column({ field: 'breached_at', type: DataType.DATE })
  declare breachedAt: Date | null;

  @Column({ field: 'state', type: DataType.STRING(20), allowNull: false })
  declare state: string;

  @Column({ field: 'warned_percents_json', type: DataType.JSONB, allowNull: false })
  declare warnedPercentsJson: number[];

  @Column({ field: '_updated_at', type: DataType.DATE })
  declare updatedAtValue: Date | null;
}
