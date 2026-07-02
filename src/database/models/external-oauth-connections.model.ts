import { Column, DataType, Model, Table } from 'sequelize-typescript';

@Table({ tableName: 'external_oauth_connections', timestamps: false })
export class ExternalOauthConnectionModel extends Model {
  @Column({ field: '_id', type: DataType.BIGINT, primaryKey: true, autoIncrement: true, allowNull: false })
  declare id: string;

  @Column({ field: '_tenant_id', type: DataType.BIGINT, allowNull: false })
  declare tenantId: string;

  @Column({ field: 'customer_id', type: DataType.BIGINT, allowNull: false })
  declare customerId: string;

  @Column({ field: 'provider_id', type: DataType.BIGINT, allowNull: false })
  declare providerId: string;

  @Column({ field: 'provider_code', type: DataType.STRING(80), allowNull: false })
  declare providerCode: string;

  @Column({ field: 'external_subject_hash', type: DataType.STRING(128) })
  declare externalSubjectHash: string | null;

  @Column({ field: 'scopes_granted_json', type: DataType.JSONB })
  declare scopesGrantedJson: string[] | null;

  @Column({ field: 'token_reference', type: DataType.TEXT })
  declare tokenReference: string | null;

  @Column({ field: 'token_expires_at', type: DataType.DATE })
  declare tokenExpiresAt: Date | null;

  @Column({ field: 'connection_status', type: DataType.STRING(30), allowNull: false })
  declare connectionStatus: string;

  @Column({ field: 'connected_at', type: DataType.DATE })
  declare connectedAt: Date | null;

  @Column({ field: 'disconnected_at', type: DataType.DATE })
  declare disconnectedAt: Date | null;

  @Column({ field: 'last_sync_at', type: DataType.DATE })
  declare lastSyncAt: Date | null;

  @Column({ field: 'metadata_json', type: DataType.JSONB })
  declare metadataJson: Record<string, unknown> | null;

  @Column({ field: '_created_at', type: DataType.DATE, allowNull: false })
  declare createdAtValue: Date;

  @Column({ field: '_updated_at', type: DataType.DATE })
  declare updatedAtValue: Date | null;
}
