import { Column, DataType, Model, Table } from 'sequelize-typescript';

@Table({ tableName: 'system_endpoint_catalog', timestamps: false })
export class SystemEndpointCatalogModel extends Model {
  @Column({ field: '_id', type: DataType.BIGINT, primaryKey: true, autoIncrement: true, allowNull: false })
  declare id: string;

  @Column({ type: DataType.STRING(180), allowNull: false, unique: true })
  declare code: string;

  @Column({ type: DataType.STRING(120), allowNull: false })
  declare module: string;

  @Column({ field: 'backend_service', type: DataType.STRING(120), allowNull: false, defaultValue: 'atlas-backend' })
  declare backendService: string;

  @Column({ field: 'backend_base_url', type: DataType.TEXT })
  declare backendBaseUrl: string | null;

  @Column({ field: 'controller_name', type: DataType.STRING(180) })
  declare controllerName: string | null;

  @Column({ field: 'handler_name', type: DataType.STRING(180) })
  declare handlerName: string | null;

  @Column({ type: DataType.STRING(12), allowNull: false })
  declare method: string;

  @Column({ field: 'route_path', type: DataType.TEXT, allowNull: false })
  declare routePath: string;

  @Column({ field: 'full_path', type: DataType.TEXT, allowNull: false })
  declare fullPath: string;

  @Column({ field: 'route_name', type: DataType.STRING(220), allowNull: false })
  declare routeName: string;

  @Column({ field: 'business_purpose', type: DataType.TEXT, allowNull: false })
  declare businessPurpose: string;

  @Column({ field: 'business_action', type: DataType.TEXT })
  declare businessAction: string | null;

  @Column({ field: 'expected_response_summary', type: DataType.TEXT })
  declare expectedResponseSummary: string | null;

  @Column({ field: 'expected_status_codes', type: DataType.JSONB, allowNull: false })
  declare expectedStatusCodes: unknown[];

  @Column({ field: 'min_payload_schema', type: DataType.JSONB, allowNull: false })
  declare minPayloadSchema: Record<string, unknown>;

  @Column({ field: 'query_params_schema', type: DataType.JSONB, allowNull: false })
  declare queryParamsSchema: Record<string, unknown>;

  @Column({ field: 'path_params_schema', type: DataType.JSONB, allowNull: false })
  declare pathParamsSchema: Record<string, unknown>;

  @Column({ field: 'headers_schema', type: DataType.JSONB, allowNull: false })
  declare headersSchema: Record<string, unknown>;

  @Column({ field: 'requires_auth', type: DataType.BOOLEAN, allowNull: false })
  declare requiresAuth: boolean;

  @Column({ field: 'allowed_roles', type: DataType.JSONB, allowNull: false })
  declare allowedRoles: string[];

  @Column({ field: 'contains_pii', type: DataType.BOOLEAN, allowNull: false })
  declare containsPii: boolean;

  @Column({ field: 'pii_fields', type: DataType.JSONB, allowNull: false })
  declare piiFields: string[];

  @Column({ field: 'risk_level', type: DataType.STRING(20), allowNull: false })
  declare riskLevel: string;

  @Column({ field: 'is_destructive', type: DataType.BOOLEAN, allowNull: false })
  declare isDestructive: boolean;

  @Column({ field: 'is_readonly', type: DataType.BOOLEAN, allowNull: false })
  declare isReadonly: boolean;

  @Column({ field: 'idempotency_required', type: DataType.BOOLEAN, allowNull: false })
  declare idempotencyRequired: boolean;

  @Column({ field: 'requires_stress_test', type: DataType.BOOLEAN, allowNull: false })
  declare requiresStressTest: boolean;

  @Column({ field: 'requires_integration_test', type: DataType.BOOLEAN, allowNull: false })
  declare requiresIntegrationTest: boolean;

  @Column({ field: 'is_testable_from_portal', type: DataType.BOOLEAN, allowNull: false })
  declare isTestableFromPortal: boolean;

  @Column({ field: 'test_environment_only', type: DataType.BOOLEAN, allowNull: false })
  declare testEnvironmentOnly: boolean;

  @Column({ field: 'owner_team', type: DataType.STRING(120), allowNull: false })
  declare ownerTeam: string;

  @Column({ type: DataType.STRING(40), allowNull: false })
  declare status: string;

  @Column({ type: DataType.STRING(40), allowNull: false })
  declare version: string;

  @Column({ field: 'detected_from', type: DataType.STRING(80), allowNull: false })
  declare detectedFrom: string;

  @Column({ field: 'confidence_level', type: DataType.STRING(20), allowNull: false })
  declare confidenceLevel: string;

  @Column({ field: 'review_status', type: DataType.STRING(40), allowNull: false })
  declare reviewStatus: string;

  @Column({ field: 'source_file', type: DataType.TEXT })
  declare sourceFile: string | null;

  @Column({ field: 'created_by', type: DataType.STRING(80) })
  declare createdBy: string | null;

  @Column({ field: 'updated_by', type: DataType.STRING(80) })
  declare updatedBy: string | null;

  @Column({ field: '_created_at', type: DataType.DATE, allowNull: false })
  declare createdAtValue: Date;

  @Column({ field: '_updated_at', type: DataType.DATE, allowNull: false })
  declare updatedAtValue: Date;
}
