/**
 * @file Modelo ORM: mapea una tabla y su contrato tipado.
 * @business Guarda cómo se presenta cada tarjeta del cliente (Normal, Silver, Gold, Premium, Black): nombre, colores y descripción.
 * @system mapea `catalog.card_tiers`, una fila por tarjeta y tenant. La tarjeta es presentación y estatus: no lleva límites.
 */
import { Column, DataType, Model, Table } from 'sequelize-typescript';
import { atlasSchemaFor } from '../domain-schemas.js';

@Table({ tableName: 'card_tiers', schema: atlasSchemaFor('card_tiers'), timestamps: false })
export class CardTierModel extends Model {
  @Column({ field: '_id', type: DataType.BIGINT, primaryKey: true, autoIncrement: true, allowNull: false })
  declare id: string;

  @Column({ field: '_tenant_id', type: DataType.BIGINT, allowNull: false })
  declare tenantId: string;

  @Column({ field: 'tier_code', type: DataType.STRING(20), allowNull: false })
  declare tierCode: string;

  @Column({ field: 'label', type: DataType.STRING(40), allowNull: false })
  declare label: string;

  /** El nivel de relación al que corresponde en automático. */
  @Column({ field: 'level_code', type: DataType.STRING(30), allowNull: false })
  declare levelCode: string;

  @Column({ field: 'display_order', type: DataType.INTEGER, allowNull: false })
  declare displayOrder: number;

  @Column({ field: 'description', type: DataType.STRING(300), allowNull: false })
  declare description: string;

  @Column({ field: 'benefits_json', type: DataType.JSONB, allowNull: false })
  declare benefitsJson: Array<{ text: string; icon?: string }>;

  @Column({ field: 'theme_json', type: DataType.JSONB, allowNull: false })
  declare themeJson: { gradient: string[]; ink: string; accent: string; finish: string; glow?: number };

  @Column({ field: 'is_active', type: DataType.BOOLEAN, allowNull: false })
  declare isActive: boolean;

  @Column({ field: '_created_at', type: DataType.DATE, allowNull: false })
  declare createdAtValue: Date;

  @Column({ field: '_updated_at', type: DataType.DATE })
  declare updatedAtValue: Date | null;

  @Column({ field: '_deleted', type: DataType.BOOLEAN, allowNull: false })
  declare deleted: boolean;
}
