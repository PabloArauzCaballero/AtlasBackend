/**
 * @file Modelo Sequelize: proyección tipada de una tabla del esquema.
 * @business Las respuestas rápidas aprobadas que un agente puede enviar sin improvisar.
 * @system `support.support_canned_responses`, versionadas y con variables permitidas explícitas.
 */
import { Column, DataType, Model, Table } from 'sequelize-typescript';
import { atlasSchemaFor } from '../domain-schemas.js';

/**
 * Una plantilla es una declaración de la empresa dicha por boca de un agente.
 *
 * Por eso se versiona igual que un artículo y por eso `allowedVariablesJson` es una lista cerrada:
 * una plantilla que admite cualquier variable acaba insertando datos sensibles en un mensaje que
 * queda para siempre en la transcripción.
 */
@Table({ tableName: 'support_canned_responses', schema: atlasSchemaFor('support_canned_responses'), timestamps: false })
export class SupportCannedResponseModel extends Model {
  @Column({ field: '_id', type: DataType.BIGINT, primaryKey: true, autoIncrement: true, allowNull: false })
  declare id: string;

  @Column({ field: '_tenant_id', type: DataType.BIGINT, allowNull: false })
  declare tenantId: string;

  @Column({ field: 'response_code', type: DataType.STRING(80), allowNull: false })
  declare responseCode: string;

  @Column({ field: 'version_number', type: DataType.INTEGER, allowNull: false })
  declare versionNumber: number;

  @Column({ field: 'locale', type: DataType.STRING(10), allowNull: false })
  declare locale: string;

  @Column({ field: 'title', type: DataType.STRING(160), allowNull: false })
  declare title: string;

  @Column({ field: 'body_md', type: DataType.TEXT, allowNull: false })
  declare bodyMd: string;

  @Column({ field: 'allowed_variables_json', type: DataType.JSONB, allowNull: false })
  declare allowedVariablesJson: string[];

  @Column({ field: 'audience', type: DataType.STRING(30), allowNull: false })
  declare audience: string;

  @Column({ field: 'team_scope', type: DataType.STRING(60) })
  declare teamScope: string | null;

  @Column({ field: 'status', type: DataType.STRING(20), allowNull: false })
  declare status: string;

  @Column({ field: 'published_at', type: DataType.DATE })
  declare publishedAt: Date | null;

  @Column({ field: 'previous_version_id', type: DataType.BIGINT })
  declare previousVersionId: string | null;

  @Column({ field: '_deleted', type: DataType.BOOLEAN, allowNull: false })
  declare deleted: boolean;

  @Column({ field: '_updated_at', type: DataType.DATE })
  declare updatedAtValue: Date | null;
}
