/**
 * @file Migración reversible: evoluciona el esquema PostgreSQL en orden.
 * @business El MDR que ve el comercio tiene que ser el que el ERP pactó DE VERDAD, no un 3.00 fijo que
 *   nadie actualiza (T-10). Cuando el ERP avisa un MDR nuevo, un aviso que llega tarde o repetido no
 *   puede pisar uno más reciente que ya se aplicó.
 * @system añade `partner.partner_profiles.mdr_rate_effective_at`: la fecha de vigencia del ÚLTIMO
 *   `mdr_rate_percent` aplicado desde el evento `merchant.mdr.updated` del ERP. `NULL` significa «nunca
 *   se recibió un aviso del ERP»: sigue mostrando el 3.00 por defecto de la migración `20260825210000`,
 *   sin inventar una fecha de vigencia que no ocurrió.
 */
import { QueryInterface } from 'sequelize';
import { atlasSchemaFor } from '../domain-schemas.js';

type MigrationContext = { context: QueryInterface };

const TABLE = `${atlasSchemaFor('partner_profiles')}.partner_profiles`;

export async function up({ context: queryInterface }: MigrationContext): Promise<void> {
  await queryInterface.sequelize.query(`ALTER TABLE ${TABLE} ADD COLUMN IF NOT EXISTS mdr_rate_effective_at TIMESTAMPTZ`);
}

export async function down({ context: queryInterface }: MigrationContext): Promise<void> {
  await queryInterface.sequelize.query(`ALTER TABLE ${TABLE} DROP COLUMN IF EXISTS mdr_rate_effective_at`);
}
