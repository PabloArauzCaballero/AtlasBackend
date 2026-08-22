/**
 * @file Modelo ORM: mapea una tabla y su contrato tipado.
 * @business Esta pieza preserva la línea de crédito vigente del cliente y el historial de cómo cambió.
 * @system define models para evolucionar, mapear, sembrar o consultar PostgreSQL de forma controlada.
 */
import { Column, DataType, Model, Table } from 'sequelize-typescript';
import { atlasSchemaFor } from '../domain-schemas.js';

@Table({ tableName: 'credit_lines', schema: atlasSchemaFor('credit_lines'), timestamps: false })
export class CreditLineModel extends Model {
  @Column({ field: '_id', type: DataType.BIGINT, primaryKey: true, autoIncrement: true, allowNull: false })
  declare id: string;

  @Column({ field: '_tenant_id', type: DataType.BIGINT, allowNull: false })
  declare tenantId: string;

  @Column({ field: 'customer_id', type: DataType.BIGINT, allowNull: false })
  declare customerId: string;

  @Column({ field: 'currency_code', type: DataType.STRING(3), allowNull: false })
  declare currencyCode: string;

  /** Lo que el cliente puede gastar. Sale de `approved_credit_limit` del artefacto, nunca de aquí. */
  @Column({ field: 'approved_limit', type: DataType.DECIMAL(18, 2), allowNull: false })
  declare approvedLimit: string;

  @Column({ field: 'max_affordable_installment', type: DataType.DECIMAL(18, 2), allowNull: true })
  declare maxAffordableInstallment: string | null;

  /** El ingreso disponible con el que se calculó: la cifra que el cliente reconoce como suya. */
  @Column({ field: 'disposable_income', type: DataType.DECIMAL(18, 2), allowNull: true })
  declare disposableIncome: string | null;

  /** El puntaje ATLAS, 0..1000. Es el que se le enseña al cliente en su perfil. */
  @Column({ field: 'scoring', type: DataType.INTEGER, allowNull: true })
  declare scoring: number | null;

  @Column({ field: 'credit_risk_score', type: DataType.INTEGER, allowNull: true })
  declare creditRiskScore: number | null;

  @Column({ field: 'risk_band', type: DataType.STRING(24), allowNull: true })
  declare riskBand: string | null;

  @Column({ field: 'pricing_tier', type: DataType.STRING(8), allowNull: true })
  declare pricingTier: string | null;

  @Column({ field: 'annual_percentage_rate', type: DataType.DECIMAL(6, 2), allowNull: true })
  declare annualPercentageRate: string | null;

  @Column({ field: 'affordability_score', type: DataType.INTEGER, allowNull: true })
  declare affordabilityScore: number | null;

  @Column({ field: 'affordability_decision', type: DataType.STRING(16), allowNull: true })
  declare affordabilityDecision: string | null;

  @Column({ field: 'probability_of_default', type: DataType.DECIMAL(6, 4), allowNull: true })
  declare probabilityOfDefault: string | null;

  @Column({ field: 'decision_outcome', type: DataType.STRING(32), allowNull: false })
  declare decisionOutcome: string;

  @Column({ field: 'decision_execution_id', type: DataType.STRING(64), allowNull: true })
  declare decisionExecutionId: string | null;

  @Column({ field: 'artifact_code', type: DataType.STRING(64), allowNull: true })
  declare artifactCode: string | null;

  @Column({ field: 'artifact_version_id', type: DataType.STRING(64), allowNull: true })
  declare artifactVersionId: string | null;

  /** Los motivos, tal y como los publicó la política. Es el «por qué» que se le enseña. */
  @Column({ field: 'reason_codes_json', type: DataType.JSONB, allowNull: true })
  declare reasonCodesJson: unknown[] | null;

  /** Qué variable era dato real, cuál derivada y cuál ausente al decidir. */
  @Column({ field: 'provenance_json', type: DataType.JSONB, allowNull: true })
  declare provenanceJson: Record<string, string> | null;

  @Column({ field: 'calculation_trigger', type: DataType.STRING(32), allowNull: false })
  declare calculationTrigger: string;

  @Column({ field: 'valid_from', type: DataType.DATE, allowNull: false })
  declare validFrom: Date;

  /** `null` marca la VIGENTE. Un índice único parcial impide que haya dos a la vez. */
  @Column({ field: 'valid_until', type: DataType.DATE, allowNull: true })
  declare validUntil: Date | null;

  @Column({ field: 'supersedes_credit_line_id', type: DataType.BIGINT, allowNull: true })
  declare supersedesCreditLineId: string | null;

  @Column({ field: '_created_at', type: DataType.DATE, allowNull: false })
  declare createdAtValue: Date;

  @Column({ field: '_updated_at', type: DataType.DATE, allowNull: false })
  declare updatedAtValue: Date;

  @Column({ field: '_deleted', type: DataType.BOOLEAN, allowNull: false })
  declare deleted: boolean;
}
