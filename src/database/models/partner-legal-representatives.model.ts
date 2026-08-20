/**
 * @file Modelo ORM: mapea una tabla y su contrato tipado.
 * @business Esta pieza preserva la fuente de verdad y la evidencia histórica que soportan decisiones y cumplimiento.
 * @system define models para evolucionar, mapear, sembrar o consultar PostgreSQL de forma controlada.
 */
import { Column, DataType, Model, Table } from 'sequelize-typescript';
import { atlasSchemaFor } from '../domain-schemas.js';

/**
 * La persona que firma por el comercio.
 *
 * Es el único tramo del onboarding del partner donde el sujeto vuelve a ser una persona natural, y
 * por eso el único donde el flujo del consumidor se reutiliza casi entero: hay un documento de
 * identidad y hay que probar que es suyo.
 *
 * Tabla propia y no columnas del perfil porque un negocio puede tener varios apoderados y el poder
 * es de cada uno. Sin `power_of_attorney_key`, «representante legal» es una afirmación que hace la
 * propia empresa sobre sí misma.
 */
@Table({
  tableName: 'partner_legal_representatives',
  schema: atlasSchemaFor('partner_legal_representatives'),
  timestamps: false,
})
export class PartnerLegalRepresentativeModel extends Model {
  @Column({ field: '_id', type: DataType.BIGINT, primaryKey: true, autoIncrement: true, allowNull: false })
  declare id: string;

  @Column({ field: '_tenant_id', type: DataType.BIGINT, allowNull: false })
  declare tenantId: string;

  @Column({ field: 'partner_profile_id', type: DataType.BIGINT, allowNull: false })
  declare partnerProfileId: string;

  @Column({ field: 'full_name', type: DataType.STRING(200), allowNull: false })
  declare fullName: string;

  @Column({ field: 'document_type', type: DataType.STRING(20), allowNull: false })
  declare documentType: string;

  @Column({ field: 'document_number', type: DataType.STRING(60), allowNull: false })
  declare documentNumber: string;

  /** Objeto del poder notarial en el almacenamiento. Sin él la representación no está probada. */
  @Column({ field: 'power_of_attorney_key', type: DataType.STRING(400) })
  declare powerOfAttorneyKey: string | null;

  @Column({ field: 'verified_at', type: DataType.DATE })
  declare verifiedAt: Date | null;

  @Column({ field: '_created_at', type: DataType.DATE, allowNull: false })
  declare createdAtValue: Date;

  @Column({ field: '_updated_at', type: DataType.DATE })
  declare updatedAtValue: Date | null;
}
