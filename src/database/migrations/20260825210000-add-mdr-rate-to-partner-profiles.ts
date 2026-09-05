/**
 * @file Migración reversible: evoluciona el esquema PostgreSQL en orden.
 * @business Cada comercio tiene su comisión (MDR): lo que Atlas le cobra por venta financiada.
 * @system añade `partner.partner_profiles.mdr_rate_percent` con un default explícito.
 */
import { QueryInterface } from 'sequelize';
import { atlasSchemaFor } from '../domain-schemas.js';

type MigrationContext = { context: QueryInterface };

const TABLE = `${atlasSchemaFor('partner_profiles')}.partner_profiles`;

/**
 * La tasa de comisión del comercio, en por ciento.
 *
 * Es lo que Atlas le cobra por el servicio de financiamiento, y se devenga sólo sobre lo que el
 * cliente EFECTIVAMENTE paga: un crédito aprobado que no se cobra no genera comisión, igual que una
 * venta que se anula. Vive junto al expediente del comercio —y no en una tabla aparte del ERP— para
 * que la cartera del negocio pueda mostrar en un solo lugar lo que le entra y lo que debe.
 *
 * El default 3.00 % es un piso razonable para no dejar comercios con comisión cero por olvido; se
 * ajusta por comercio desde el ERP interno de Atlas, que es donde se negocia el término comercial.
 */
export async function up({ context: queryInterface }: MigrationContext): Promise<void> {
  await queryInterface.sequelize.query(
    `ALTER TABLE ${TABLE} ADD COLUMN IF NOT EXISTS mdr_rate_percent NUMERIC(5,2) NOT NULL DEFAULT 3.00`,
  );
}

export async function down({ context: queryInterface }: MigrationContext): Promise<void> {
  await queryInterface.sequelize.query(`ALTER TABLE ${TABLE} DROP COLUMN IF EXISTS mdr_rate_percent`);
}
