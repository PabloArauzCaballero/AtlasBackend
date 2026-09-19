/**
 * @file Modelo Sequelize: proyección tipada de una tabla del esquema.
 * @business El expediente de soporte: qué pidió alguien, cómo se clasificó y en qué estado está.
 * @system `support.support_cases`, estado actual del caso; su historia vive en `support_case_events`.
 */
import { Column, DataType, Model, Table } from 'sequelize-typescript';
import { atlasSchemaFor } from '../domain-schemas.js';

/**
 * El caso es el expediente; el chat es sólo un canal.
 *
 * Esta fila es una PROYECCIÓN para poder listar, filtrar y enrutar: se actualiza sin problema
 * porque no es la evidencia. La evidencia de cómo se llegó hasta aquí es `support_case_events`, que
 * no se toca nunca. Cerrar el chat no cierra el caso, y una caída de conexión no resuelve nada.
 */
@Table({ tableName: 'support_cases', schema: atlasSchemaFor('support_cases'), timestamps: false })
export class SupportCaseModel extends Model {
  @Column({ field: '_id', type: DataType.BIGINT, primaryKey: true, autoIncrement: true, allowNull: false })
  declare id: string;

  @Column({ field: '_tenant_id', type: DataType.BIGINT, allowNull: false })
  declare tenantId: string;

  /** Número legible que se dicta por teléfono (ATL-SUP-2026-00000123). No es la PK. */
  @Column({ field: 'case_number', type: DataType.STRING(40), allowNull: false })
  declare caseNumber: string;

  @Column({ field: 'subject_context_type', type: DataType.STRING(30), allowNull: false })
  declare subjectContextType: string;

  @Column({ field: 'subject_customer_id', type: DataType.BIGINT })
  declare subjectCustomerId: string | null;

  @Column({ field: 'subject_partner_profile_id', type: DataType.BIGINT })
  declare subjectPartnerProfileId: string | null;

  @Column({ field: 'opened_by_actor_type', type: DataType.STRING(30), allowNull: false })
  declare openedByActorType: string;

  @Column({ field: 'opened_by_actor_id', type: DataType.STRING(64), allowNull: false })
  declare openedByActorId: string;

  @Column({ field: 'requester_display_name', type: DataType.STRING(160) })
  declare requesterDisplayName: string | null;

  @Column({ field: 'origin_channel', type: DataType.STRING(30), allowNull: false })
  declare originChannel: string;

  @Column({ field: 'case_type', type: DataType.STRING(40), allowNull: false })
  declare caseType: string;

  @Column({ field: 'domain', type: DataType.STRING(30), allowNull: false })
  declare domain: string;

  @Column({ field: 'category_id', type: DataType.BIGINT })
  declare categoryId: string | null;

  @Column({ field: 'priority', type: DataType.STRING(4), allowNull: false })
  declare priority: string;

  @Column({ field: 'impact', type: DataType.STRING(20), allowNull: false })
  declare impact: string;

  @Column({ field: 'urgency', type: DataType.STRING(20), allowNull: false })
  declare urgency: string;

  @Column({ field: 'sensitivity', type: DataType.STRING(20), allowNull: false })
  declare sensitivity: string;

  @Column({ field: 'status', type: DataType.STRING(30), allowNull: false })
  declare status: string;

  @Column({ field: 'queue_id', type: DataType.BIGINT })
  declare queueId: string | null;

  @Column({ field: 'current_assignee_agent_id', type: DataType.BIGINT })
  declare currentAssigneeAgentId: string | null;

  @Column({ field: 'title', type: DataType.STRING(200), allowNull: false })
  declare title: string;

  /** Lo que el cliente puede leer. Separado del interno para que nunca se confundan. */
  @Column({ field: 'public_summary', type: DataType.TEXT })
  declare publicSummary: string | null;

  @Column({ field: 'internal_summary', type: DataType.TEXT })
  declare internalSummary: string | null;

  @Column({ field: 'partner_visibility', type: DataType.STRING(30), allowNull: false })
  declare partnerVisibility: string;

  @Column({ field: 'locale', type: DataType.STRING(10), allowNull: false })
  declare locale: string;

  @Column({ field: 'origin_context_json', type: DataType.JSONB })
  declare originContextJson: Record<string, unknown> | null;

  @Column({ field: 'opened_at', type: DataType.DATE, allowNull: false })
  declare openedAt: Date;

  @Column({ field: 'triaged_at', type: DataType.DATE })
  declare triagedAt: Date | null;

  @Column({ field: 'first_response_at', type: DataType.DATE })
  declare firstResponseAt: Date | null;

  @Column({ field: 'resolved_at', type: DataType.DATE })
  declare resolvedAt: Date | null;

  @Column({ field: 'closed_at', type: DataType.DATE })
  declare closedAt: Date | null;

  @Column({ field: 'last_activity_at', type: DataType.DATE, allowNull: false })
  declare lastActivityAt: Date;

  @Column({ field: 'reopened_count', type: DataType.INTEGER, allowNull: false })
  declare reopenedCount: number;

  @Column({ field: 'transfer_count', type: DataType.INTEGER, allowNull: false })
  declare transferCount: number;

  @Column({ field: 'escalation_level', type: DataType.INTEGER, allowNull: false })
  declare escalationLevel: number;

  @Column({ field: 'sla_policy_version_id', type: DataType.BIGINT })
  declare slaPolicyVersionId: string | null;

  @Column({ field: 'retention_class_code', type: DataType.STRING(60), allowNull: false })
  declare retentionClassCode: string;

  /** Mientras esté en TRUE ninguna rutina de disposición puede tocar el expediente. */
  @Column({ field: 'legal_hold', type: DataType.BOOLEAN, allowNull: false })
  declare legalHold: boolean;

  @Column({ field: 'legal_hold_reason', type: DataType.STRING(400) })
  declare legalHoldReason: string | null;

  @Column({ field: 'legal_hold_set_at', type: DataType.DATE })
  declare legalHoldSetAt: Date | null;

  @Column({ field: 'last_event_sequence', type: DataType.BIGINT, allowNull: false })
  declare lastEventSequence: string;

  @Column({ field: 'correlation_id', type: DataType.STRING(64) })
  declare correlationId: string | null;

  @Column({ field: '_deleted', type: DataType.BOOLEAN, allowNull: false })
  declare deleted: boolean;

  @Column({ field: '_updated_at', type: DataType.DATE })
  declare updatedAtValue: Date | null;
}
