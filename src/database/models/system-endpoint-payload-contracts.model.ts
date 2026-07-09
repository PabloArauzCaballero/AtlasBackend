import { Column, DataType, ForeignKey, Model, Table } from 'sequelize-typescript';
import { SystemEndpointCatalogModel } from './system-endpoint-catalog.model.js';

@Table({ tableName: 'system_endpoint_payload_contracts', timestamps: false })
export class SystemEndpointPayloadContractModel extends Model {
  @Column({ field: '_id', type: DataType.BIGINT, primaryKey: true, autoIncrement: true, allowNull: false })
  declare id: string;

  @ForeignKey(() => SystemEndpointCatalogModel)
  @Column({ field: 'endpoint_id', type: DataType.BIGINT, allowNull: false })
  declare endpointId: string;

  @Column({ field: 'contract_type', type: DataType.STRING(20), allowNull: false })
  declare contractType: string;

  @Column({ field: 'schema_reference', type: DataType.STRING(180) })
  declare schemaReference: string | null;

  @Column({ field: 'dto_reference', type: DataType.STRING(180) })
  declare dtoReference: string | null;

  @Column({ field: 'schema_json', type: DataType.JSONB, allowNull: false })
  declare schemaJson: Record<string, unknown>;

  @Column({ field: 'required_fields_json', type: DataType.JSONB, allowNull: false })
  declare requiredFieldsJson: string[];

  @Column({ field: 'optional_fields_json', type: DataType.JSONB, allowNull: false })
  declare optionalFieldsJson: string[];

  @Column({ field: 'sample_payload_json', type: DataType.JSONB, allowNull: false })
  declare samplePayloadJson: Record<string, unknown>;

  @Column({ field: 'business_reason', type: DataType.TEXT })
  declare businessReason: string | null;

  @Column({ field: 'validation_layer', type: DataType.STRING(80), allowNull: false })
  declare validationLayer: string;

  @Column({ field: 'source_file', type: DataType.TEXT })
  declare sourceFile: string | null;

  @Column({ field: 'confidence_level', type: DataType.STRING(20), allowNull: false })
  declare confidenceLevel: string;

  @Column({ field: 'review_status', type: DataType.STRING(40), allowNull: false })
  declare reviewStatus: string;

  @Column({ field: '_created_at', type: DataType.DATE, allowNull: false })
  declare createdAtValue: Date;

  @Column({ field: '_updated_at', type: DataType.DATE, allowNull: false })
  declare updatedAtValue: Date;
}
