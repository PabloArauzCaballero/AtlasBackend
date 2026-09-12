/**
 * @file Modelo Sequelize: proyección tipada de una tabla del esquema.
 * @business La promesa de atención por prioridad: en cuánto se responde, se actualiza y se resuelve.
 * @system `support.support_sla_policies`, versionada: un caso guarda la versión que se le aplicó.
 */
import { Column, DataType, Model, Table } from 'sequelize-typescript';
import { atlasSchemaFor } from '../domain-schemas.js';

/**
 * La política NO se edita: se publica otra versión.
 *
 * Un caso se juzga con la promesa vigente el día que se abrió. Editar los plazos en caliente
 * "arreglaría" retroactivamente los incumplimientos del trimestre pasado, que es justo lo que un
 * indicador de SLA no debe permitir.
 */
@Table({ tableName: 'support_sla_policies', schema: atlasSchemaFor('support_sla_policies'), timestamps: false })
export class SupportSlaPolicyModel extends Model {
  @Column({ field: '_id', type: DataType.BIGINT, primaryKey: true, autoIncrement: true, allowNull: false })
  declare id: string;

  @Column({ field: '_tenant_id', type: DataType.BIGINT, allowNull: false })
  declare tenantId: string;

  @Column({ field: 'policy_code', type: DataType.STRING(60), allowNull: false })
  declare policyCode: string;

  @Column({ field: 'version_number', type: DataType.INTEGER, allowNull: false })
  declare versionNumber: number;

  @Column({ field: 'priority', type: DataType.STRING(4), allowNull: false })
  declare priority: string;

  @Column({ field: 'status', type: DataType.STRING(20), allowNull: false })
  declare status: string;

  @Column({ field: 'calendar_kind', type: DataType.STRING(20), allowNull: false })
  declare calendarKind: string;

  @Column({ field: 'timezone', type: DataType.STRING(60), allowNull: false })
  declare timezone: string;

  @Column({ field: 'acknowledge_target_minutes', type: DataType.INTEGER, allowNull: false })
  declare acknowledgeTargetMinutes: number;

  @Column({ field: 'first_response_target_minutes', type: DataType.INTEGER, allowNull: false })
  declare firstResponseTargetMinutes: number;

  @Column({ field: 'update_interval_minutes', type: DataType.INTEGER, allowNull: false })
  declare updateIntervalMinutes: number;

  @Column({ field: 'resolution_target_minutes', type: DataType.INTEGER, allowNull: false })
  declare resolutionTargetMinutes: number;

  @Column({ field: 'pause_on_waiting_customer', type: DataType.BOOLEAN, allowNull: false })
  declare pauseOnWaitingCustomer: boolean;

  @Column({ field: 'pause_on_waiting_partner', type: DataType.BOOLEAN, allowNull: false })
  declare pauseOnWaitingPartner: boolean;

  @Column({ field: 'pause_on_waiting_internal', type: DataType.BOOLEAN, allowNull: false })
  declare pauseOnWaitingInternal: boolean;

  @Column({ field: 'warning_percents_json', type: DataType.JSONB, allowNull: false })
  declare warningPercentsJson: number[];

  @Column({ field: 'business_hours_json', type: DataType.JSONB })
  declare businessHoursJson: Record<string, unknown> | null;

  @Column({ field: 'effective_from', type: DataType.DATE, allowNull: false })
  declare effectiveFrom: Date;

  @Column({ field: 'effective_to', type: DataType.DATE })
  declare effectiveTo: Date | null;

  @Column({ field: 'previous_version_id', type: DataType.BIGINT })
  declare previousVersionId: string | null;

  @Column({ field: 'change_reason', type: DataType.STRING(400) })
  declare changeReason: string | null;

  @Column({ field: '_deleted', type: DataType.BOOLEAN, allowNull: false })
  declare deleted: boolean;

  @Column({ field: '_updated_at', type: DataType.DATE })
  declare updatedAtValue: Date | null;
}
