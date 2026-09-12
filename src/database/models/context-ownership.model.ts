/**
 * @file Modelo ORM: mapea una tabla y su contrato tipado.
 * @business Esta pieza dice quién es HOY el único escritor de un contexto (monolito o servicio piloto) y con qué época.
 * @system define `context_ownership` (AT-059): un dueño por contexto, época monótona para cercar escritores viejos.
 */
import { Column, DataType, Model, Table } from 'sequelize-typescript';
import { atlasSchemaFor } from '../domain-schemas.js';

@Table({ tableName: 'context_ownership', schema: atlasSchemaFor('context_ownership'), timestamps: false })
export class ContextOwnershipModel extends Model {
  @Column({ field: 'context', type: DataType.STRING(60), primaryKey: true, allowNull: false })
  declare context: string;

  @Column({ field: 'owner', type: DataType.STRING(80), allowNull: false })
  declare owner: string;

  @Column({ field: 'epoch', type: DataType.BIGINT, allowNull: false })
  declare epoch: string;

  @Column({ field: 'changed_by', type: DataType.STRING(120) })
  declare changedBy: string | null;

  @Column({ field: 'changed_at', type: DataType.DATE, allowNull: false })
  declare changedAt: Date;
}
