/**
 * @file Migración reversible: evoluciona el esquema PostgreSQL en orden.
 * @business El 60 % que el cliente paga directo al comercio al comprar necesita su propio rastro: quién lo avisó, con qué comprobante y si el comercio lo confirmó.
 * @system agrega a `credit_applications` las columnas del pago inicial (importe, estado, comprobante, decisión).
 */
import { DataTypes, QueryInterface } from 'sequelize';
import { atlasSchemaFor } from '../domain-schemas.js';

type MigrationContext = { context: QueryInterface };

const TABLA = { tableName: 'credit_applications', schema: atlasSchemaFor('credit_applications') };
const TABLA_SQL = `${atlasSchemaFor('credit_applications')}.credit_applications`;
const CHECK = 'ck_credit_applications_down_payment_status';

/**
 * Todo nulable: una solicitud sin comercio, una renovación o una anterior a esta migración no tienen pago inicial,
 * y `NULL` significa exactamente eso («no hay nada que avisar»), no «pendiente».
 *
 * Va en la solicitud y no en una tabla aparte porque es UN pago por solicitud y se lee siempre junto con ella
 * (el comercio ve la solicitud, el cliente ve la solicitud). El comprobante es una fila de `evidence_documents`,
 * como el del aviso de una cuota; aquí sólo se guarda su id.
 */
export async function up({ context: queryInterface }: MigrationContext): Promise<void> {
  const columnas = await queryInterface.describeTable(TABLA);
  const nuevas: Record<string, ReturnType<() => Parameters<QueryInterface['addColumn']>[2]>> = {
    down_payment_amount: { type: DataTypes.DECIMAL(18, 2), allowNull: true },
    down_payment_status: { type: DataTypes.STRING(20), allowNull: true },
    down_payment_proof_evidence_id: { type: DataTypes.BIGINT, allowNull: true },
    down_payment_payer_reference: { type: DataTypes.STRING(160), allowNull: true },
    down_payment_submitted_at: { type: DataTypes.DATE, allowNull: true },
    down_payment_decided_at: { type: DataTypes.DATE, allowNull: true },
    down_payment_decided_by: { type: DataTypes.STRING(160), allowNull: true },
    down_payment_rejection_reason: { type: DataTypes.STRING(300), allowNull: true },
  };
  for (const [nombre, definicion] of Object.entries(nuevas)) {
    if (!columnas[nombre]) await queryInterface.addColumn(TABLA, nombre, definicion);
  }
  await queryInterface.sequelize.query(`ALTER TABLE ${TABLA_SQL} DROP CONSTRAINT IF EXISTS ${CHECK};`);
  await queryInterface.sequelize.query(
    `ALTER TABLE ${TABLA_SQL} ADD CONSTRAINT ${CHECK} CHECK (down_payment_status IS NULL OR down_payment_status IN ('submitted', 'confirmed', 'rejected'));`,
  );
}

export async function down({ context: queryInterface }: MigrationContext): Promise<void> {
  await queryInterface.sequelize.query(`ALTER TABLE ${TABLA_SQL} DROP CONSTRAINT IF EXISTS ${CHECK};`);
  for (const columna of [
    'down_payment_rejection_reason',
    'down_payment_decided_by',
    'down_payment_decided_at',
    'down_payment_submitted_at',
    'down_payment_payer_reference',
    'down_payment_proof_evidence_id',
    'down_payment_status',
    'down_payment_amount',
  ]) {
    await queryInterface.removeColumn(TABLA, columna);
  }
}
