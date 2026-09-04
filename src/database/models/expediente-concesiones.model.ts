/**
 * @file Modelo ORM: mapea una tabla y su contrato tipado.
 * @business Quién puede ver o tocar una carpeta, y con qué justificación.
 * @system define la concesión de acceso sobre un nodo; se hereda hacia sus descendientes.
 */
import { Column, DataType, Model, Table } from 'sequelize-typescript';
import { atlasSchemaFor } from '../domain-schemas.js';

@Table({ tableName: 'expediente_concesiones', schema: atlasSchemaFor('expediente_concesiones'), timestamps: false })
export class ExpedienteConcesionModel extends Model {
  @Column({ field: '_id', type: DataType.BIGINT, primaryKey: true, autoIncrement: true, allowNull: false })
  declare id: string;

  @Column({ field: '_tenant_id', type: DataType.BIGINT, allowNull: false })
  declare tenantId: string;

  @Column({ field: 'nodo_id', type: DataType.BIGINT, allowNull: false })
  declare nodoId: string;

  @Column({ field: 'principal_tipo', type: DataType.STRING(20), allowNull: false })
  declare principalTipo: string;

  @Column({ field: 'principal_id', type: DataType.STRING(64), allowNull: false })
  declare principalId: string;

  @Column({ field: 'nivel', type: DataType.STRING(20), allowNull: false })
  declare nivel: string;

  @Column({ field: 'otorgado_por_id', type: DataType.BIGINT })
  declare otorgadoPorId: string | null;

  @Column({ field: 'motivo', type: DataType.TEXT })
  declare motivo: string | null;

  @Column({ field: 'vence_en', type: DataType.DATE })
  declare venceEn: Date | null;

  @Column({ field: 'created_at', type: DataType.DATE, allowNull: false })
  declare createdAtValue: Date;

  @Column({ field: 'revocado_en', type: DataType.DATE })
  declare revocadoEn: Date | null;

  @Column({ field: 'revocado_por_id', type: DataType.BIGINT })
  declare revocadoPorId: string | null;
}
