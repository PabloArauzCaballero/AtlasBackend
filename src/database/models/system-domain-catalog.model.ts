import { Column, DataType, Model, Table } from 'sequelize-typescript';

@Table({ tableName: 'system_domain_catalog', timestamps: false })
export class SystemDomainCatalogModel extends Model {
  @Column({ field: '_id', type: DataType.BIGINT, primaryKey: true, autoIncrement: true, allowNull: false })
  declare id: string;

  @Column({ field: 'domain_code', type: DataType.STRING(120), allowNull: false, unique: true })
  declare domainCode: string;

  @Column({ field: 'domain_name', type: DataType.STRING(220), allowNull: false })
  declare domainName: string;

  @Column({ type: DataType.TEXT, allowNull: false })
  declare description: string;

  @Column({ field: 'business_definition', type: DataType.TEXT, allowNull: false })
  declare businessDefinition: string;

  @Column({ field: 'technical_scope', type: DataType.TEXT, allowNull: false })
  declare technicalScope: string;

  @Column({ field: 'data_nature', type: DataType.STRING(60), allowNull: false })
  declare dataNature: string;

  @Column({ field: 'owner_team', type: DataType.STRING(120), allowNull: false })
  declare ownerTeam: string;

  @Column({ field: 'countries_applicable', type: DataType.JSONB, allowNull: false })
  declare countriesApplicable: string[];

  @Column({ field: 'regulatory_notes', type: DataType.TEXT })
  declare regulatoryNotes: string | null;

  @Column({ field: 'example_tables', type: DataType.JSONB, allowNull: false })
  declare exampleTables: string[];

  @Column({ field: 'decision_use_cases', type: DataType.JSONB, allowNull: false })
  declare decisionUseCases: string[];

  @Column({ field: 'audit_relevance', type: DataType.TEXT })
  declare auditRelevance: string | null;

  @Column({ type: DataType.STRING(40), allowNull: false })
  declare status: string;

  @Column({ field: '_created_at', type: DataType.DATE, allowNull: false })
  declare createdAtValue: Date;

  @Column({ field: '_updated_at', type: DataType.DATE, allowNull: false })
  declare updatedAtValue: Date;
}
