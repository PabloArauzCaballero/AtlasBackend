/**
 * @file Migración reversible: evoluciona el esquema PostgreSQL en orden.
 * @business Dos concesiones simultáneas no pueden repartirse el mismo cupo (P-11, brecha B15).
 * @system crea `credit_exposure_reservations`: la reserva del límite que la concesión consume o libera.
 */
import { QueryInterface } from 'sequelize';
import { atlasSchemaFor } from '../domain-schemas.js';

type MigrationContext = { context: QueryInterface };

const SCHEMA = atlasSchemaFor('credit_exposure_reservations');
const TABLE = `${SCHEMA}.credit_exposure_reservations`;
const TENANTS = `${atlasSchemaFor('tenants')}.tenants`;

/**
 * Por qué hace falta.
 *
 * La línea de crédito (`credit_lines.approved_limit`) decía cuánto podía deber un cliente, pero el
 * desembolso nunca la leía: dos solicitudes aprobadas de 80 sobre un cliente con 900 de deuda y
 * 1.000 de límite se desembolsaban las dos. Leer la suma antes de escribir no basta —dos
 * transacciones leen la misma suma—, así que la concesión reserva el cupo bajo el cerrojo del
 * cliente y la reserva queda escrita: `reserved` mientras la decisión está vigente, `consumed`
 * cuando se convierte en préstamo, `released` cuando se cancela. El índice único parcial impide
 * dos reservas vivas para la misma solicitud, y el `CHECK` sobre el estado impide un cuarto estado
 * que nadie contaría.
 */
export async function up({ context: queryInterface }: MigrationContext): Promise<void> {
  await queryInterface.sequelize.query(`
CREATE TABLE IF NOT EXISTS ${TABLE} (
  _id                    BIGSERIAL PRIMARY KEY,
  _tenant_id             BIGINT        NOT NULL REFERENCES ${TENANTS}(_id) ON UPDATE CASCADE ON DELETE RESTRICT,
  customer_id            BIGINT        NOT NULL,
  credit_application_id  BIGINT        NOT NULL,
  amount                 NUMERIC(18,2) NOT NULL CHECK (amount > 0),
  currency_code          VARCHAR(3)    NOT NULL,
  status                 VARCHAR(20)   NOT NULL CHECK (status IN ('reserved','consumed','released')),
  expires_at             TIMESTAMPTZ   NOT NULL,
  loan_id                BIGINT,
  release_reason         VARCHAR(120),
  reserved_at            TIMESTAMPTZ   NOT NULL,
  consumed_at            TIMESTAMPTZ,
  released_at            TIMESTAMPTZ,
  _created_at            TIMESTAMPTZ   NOT NULL DEFAULT now(),
  _updated_at            TIMESTAMPTZ
);`);
  await queryInterface.sequelize.query(
    `CREATE UNIQUE INDEX IF NOT EXISTS ux_credit_exposure_reservations_live
       ON ${TABLE} (_tenant_id, credit_application_id) WHERE status IN ('reserved','consumed');`,
  );
  await queryInterface.sequelize.query(
    `CREATE INDEX IF NOT EXISTS ix_credit_exposure_reservations_customer
       ON ${TABLE} (_tenant_id, customer_id) WHERE status = 'reserved';`,
  );
}

/**
 * El `down` se niega a borrar reservas: una reserva consumida es el rastro de qué cupo tomó cada
 * préstamo. Sólo retira la tabla si está vacía (una reinstalación o el `down → up` de CI).
 */
export async function down({ context: queryInterface }: MigrationContext): Promise<void> {
  await queryInterface.sequelize.query(`
DO $$
BEGIN
  IF to_regclass('${TABLE}') IS NOT NULL AND EXISTS (SELECT 1 FROM ${TABLE}) THEN
    RAISE EXCEPTION 'credit_exposure_reservations tiene filas: no se revierte para no perder el rastro de cupos';
  END IF;
END $$;`);
  await queryInterface.sequelize.query(`DROP TABLE IF EXISTS ${TABLE};`);
}
