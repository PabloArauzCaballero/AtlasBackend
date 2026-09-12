/**
 * @file Modelo ORM: mapea una tabla y su contrato tipado.
 * @business Esta pieza preserva la fuente de verdad y la evidencia histórica que soportan decisiones y cumplimiento.
 * @system define models para evolucionar, mapear, sembrar o consultar PostgreSQL de forma controlada.
 */
import { Column, DataType, Model, Table } from 'sequelize-typescript';
import { atlasSchemaFor } from '../domain-schemas.js';

/**
 * Correspondencia entre un cliente y el sujeto opaco que ve el motor de decisión.
 *
 * El motor guarda `subject_reference_hash` y nada más: un identificador sin significado, indexado
 * para poder atender una solicitud del titular sin que el motor sepa nunca a quién decide. Esa
 * opacidad es correcta y se conserva. Pero un hash no se puede deshacer, así que sin esta tabla
 * nadie puede responder «tráeme la historia del cliente detrás de estas decisiones» — ni el equipo
 * de riesgo al recalibrar, ni el de cumplimiento al atender un reclamo.
 *
 * La correspondencia vive aquí, en el core, donde el dato personal ya reside y está bajo sus
 * políticas de retención y consentimiento. Llevarla al motor habría convertido un sistema que no
 * conoce a nadie en uno que sí.
 */
@Table({ tableName: 'decision_subject_links', schema: atlasSchemaFor('decision_subject_links'), timestamps: false })
export class DecisionSubjectLinkModel extends Model {
  @Column({ field: '_id', type: DataType.BIGINT, primaryKey: true, autoIncrement: true, allowNull: false })
  declare id: string;

  @Column({ field: '_tenant_id', type: DataType.BIGINT, allowNull: false })
  declare tenantId: string;

  @Column({ field: 'customer_id', type: DataType.BIGINT, allowNull: false })
  declare customerId: string;

  @Column({ field: 'subject_reference', type: DataType.STRING(128), allowNull: false })
  declare subjectReference: string;

  /** Para qué se emitió. Un mismo cliente tiene referencias distintas por propósito. */
  @Column({ field: 'purpose_code', type: DataType.STRING(80), allowNull: false })
  declare purposeCode: string;

  @Column({ field: 'first_seen_at', type: DataType.DATE, allowNull: false })
  declare firstSeenAt: Date;

  @Column({ field: 'last_seen_at', type: DataType.DATE, allowNull: false })
  declare lastSeenAt: Date;

  @Column({ field: 'decision_count', type: DataType.INTEGER, allowNull: false })
  declare decisionCount: number;

  @Column({ field: '_created_at', type: DataType.DATE, allowNull: false })
  declare createdAtValue: Date;

  @Column({ field: '_updated_at', type: DataType.DATE })
  declare updatedAtValue: Date | null;
}
