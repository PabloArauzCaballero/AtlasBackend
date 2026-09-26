/**
 * @file Modelo Sequelize: proyección tipada de una tabla del esquema.
 * @business Qué se resolvió, con qué código, qué se le dijo al cliente y qué se anotó adentro.
 * @system `support.support_resolutions`; una reapertura no borra la anterior, agrega otra secuencia.
 */
import { Column, DataType, Model, Table } from 'sequelize-typescript';
import { atlasSchemaFor } from '../domain-schemas.js';

/**
 * «DONE» no es una resolución.
 *
 * `resolutionCode` y `rootCauseCode` son lo que convierte casos sueltos en aprendizaje: sin ellos
 * nadie puede ver que doscientos casos al mes salen de la misma causa. Y la causa raíz puede
 * quedarse en `UNKNOWN` al cerrar: fingir que se conoce es peor que admitir que se determinará en
 * gestión de problemas.
 */
@Table({ tableName: 'support_resolutions', schema: atlasSchemaFor('support_resolutions'), timestamps: false })
export class SupportResolutionModel extends Model {
  @Column({ field: '_id', type: DataType.BIGINT, primaryKey: true, autoIncrement: true, allowNull: false })
  declare id: string;

  @Column({ field: '_tenant_id', type: DataType.BIGINT, allowNull: false })
  declare tenantId: string;

  @Column({ field: 'case_id', type: DataType.BIGINT, allowNull: false })
  declare caseId: string;

  @Column({ field: 'resolution_sequence', type: DataType.INTEGER, allowNull: false })
  declare resolutionSequence: number;

  @Column({ field: 'resolution_code', type: DataType.STRING(60), allowNull: false })
  declare resolutionCode: string;

  @Column({ field: 'root_cause_code', type: DataType.STRING(60), allowNull: false })
  declare rootCauseCode: string;

  @Column({ field: 'customer_resolution', type: DataType.TEXT, allowNull: false })
  declare customerResolution: string;

  @Column({ field: 'internal_resolution', type: DataType.TEXT, allowNull: false })
  declare internalResolution: string;

  @Column({ field: 'workaround_description', type: DataType.TEXT })
  declare workaroundDescription: string | null;

  @Column({ field: 'resolved_by_agent_id', type: DataType.BIGINT })
  declare resolvedByAgentId: string | null;

  @Column({ field: 'resolved_by_actor_id', type: DataType.STRING(64) })
  declare resolvedByActorId: string | null;

  @Column({ field: 'resolved_at', type: DataType.DATE, allowNull: false })
  declare resolvedAt: Date;

  @Column({ field: 'superseded_at', type: DataType.DATE })
  declare supersededAt: Date | null;
}
