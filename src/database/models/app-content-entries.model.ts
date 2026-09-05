/**
 * @file Modelo ORM: mapea una tabla y su contrato tipado.
 * @business Esta pieza saca del código lo que el cliente lee en la app y lo pone donde se edita.
 * @system mapea el catálogo de contenidos de la app por pantalla, clave e idioma.
 */
import { Column, DataType, Model, Table } from 'sequelize-typescript';
import { atlasSchemaFor } from '../domain-schemas.js';

export type ContentBullet = { text: string; icon?: string | null; emphasis?: boolean };

@Table({ tableName: 'app_content_entries', schema: atlasSchemaFor('app_content_entries'), timestamps: false })
export class AppContentEntryModel extends Model {
  @Column({ field: '_id', type: DataType.BIGINT, primaryKey: true, autoIncrement: true, allowNull: false })
  declare id: string;

  @Column({ field: '_tenant_id', type: DataType.BIGINT, allowNull: false })
  declare tenantId: string;

  @Column({ field: 'surface', type: DataType.STRING(40), allowNull: false })
  declare surface: string;

  @Column({ field: 'content_key', type: DataType.STRING(120), allowNull: false })
  declare contentKey: string;

  @Column({ field: 'locale', type: DataType.STRING(10), allowNull: false })
  declare locale: string;

  @Column({ field: 'title', type: DataType.STRING(200) })
  declare title: string | null;

  @Column({ field: 'subtitle', type: DataType.STRING(300) })
  declare subtitle: string | null;

  @Column({ field: 'body_md', type: DataType.TEXT })
  declare bodyMd: string | null;

  @Column({ field: 'bullets_json', type: DataType.JSONB })
  declare bulletsJson: ContentBullet[] | null;

  @Column({ field: 'metadata_json', type: DataType.JSONB })
  declare metadataJson: Record<string, unknown> | null;

  @Column({ field: 'action_kind', type: DataType.STRING(24) })
  declare actionKind: string | null;

  @Column({ field: 'action_label', type: DataType.STRING(120) })
  declare actionLabel: string | null;

  @Column({ field: 'action_value', type: DataType.STRING(500) })
  declare actionValue: string | null;

  @Column({ field: 'display_order', type: DataType.INTEGER, allowNull: false })
  declare displayOrder: number;

  @Column({ field: 'is_active', type: DataType.BOOLEAN, allowNull: false })
  declare isActive: boolean;

  @Column({ field: 'published_at', type: DataType.DATE })
  declare publishedAt: Date | null;

  @Column({ field: 'updated_by_internal_user_id', type: DataType.BIGINT })
  declare updatedByInternalUserId: string | null;

  @Column({ field: '_created_at', type: DataType.DATE, allowNull: false })
  declare createdAtValue: Date;

  @Column({ field: '_updated_at', type: DataType.DATE })
  declare updatedAtValue: Date | null;

  @Column({ field: '_deleted', type: DataType.BOOLEAN, allowNull: false })
  declare deleted: boolean;
}
