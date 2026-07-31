/**
 * @file Modelo ORM: mapea una tabla y su contrato tipado.
 * @business Esta pieza preserva la fuente de verdad y la evidencia histórica que soportan decisiones y cumplimiento.
 * @system define models para evolucionar, mapear, sembrar o consultar PostgreSQL de forma controlada.
 */
import { Column, DataType, Model, Table } from 'sequelize-typescript';
import { atlasSchemaFor } from '../domain-schemas.js';

@Table({ tableName: 'system_catalog_review_events', schema: atlasSchemaFor('system_catalog_review_events'), timestamps: false })
export class SystemCatalogReviewEventModel extends Model {
  @Column({ field: '_id', type: DataType.BIGINT, primaryKey: true, autoIncrement: true }) declare id: string;
  @Column({ field: '_tenant_id', type: DataType.BIGINT }) declare tenantId: string | null;
  @Column({ field: 'target_type', type: DataType.STRING(80), allowNull: false }) declare targetType: string;
  @Column({ field: 'target_id', type: DataType.BIGINT, allowNull: false }) declare targetId: string;
  @Column({ field: 'previous_status', type: DataType.STRING(40) }) declare previousStatus: string | null;
  @Column({ field: 'new_status', type: DataType.STRING(40), allowNull: false }) declare newStatus: string;
  @Column({ field: 'previous_confidence', type: DataType.STRING(40) }) declare previousConfidence: string | null;
  @Column({ field: 'new_confidence', type: DataType.STRING(40) }) declare newConfidence: string | null;
  @Column({ type: DataType.TEXT }) declare notes: string | null;
  @Column({ field: 'actor_id', type: DataType.STRING(120) }) declare actorId: string | null;
  @Column({ field: 'actor_role', type: DataType.STRING(80), allowNull: false }) declare actorRole: string;
  @Column({ field: '_created_at', type: DataType.DATE, allowNull: false }) declare createdAtValue: Date;
}
