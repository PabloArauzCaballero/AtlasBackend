/**
 * @file Migración reversible: evoluciona el esquema PostgreSQL en orden.
 * @business Esta pieza preserva la fuente de verdad y la evidencia histórica que soportan decisiones y cumplimiento.
 * @system define migrations para evolucionar, mapear, sembrar o consultar PostgreSQL de forma controlada.
 */
import { QueryInterface } from 'sequelize';
import { atlasSchemaFor } from '../domain-schemas.js';

type MigrationContext = { context: QueryInterface };

const PROFILES = `${atlasSchemaFor('partner_profiles')}.partner_profiles`;

/**
 * Verificación del contacto declarado por el comercio.
 *
 * `email_verified_at` existía desde la primera migración y **nada lo escribía**: el expediente
 * distinguía el contacto DECLARADO del PROBADO en su esquema y no tenía forma de probar ninguno.
 * Esto añade lo que faltaba para cerrar ese eslabón.
 *
 * Va en columnas del perfil y no en tabla aparte porque sólo puede haber UNA verificación en curso
 * por comercio: pedir un código nuevo invalida el anterior, que es justamente lo que se quiere —dos
 * códigos vivos a la vez duplican la ventana en la que uno sirve—.
 *
 * `contact_code_attempts` es la mitad que se olvida: sin contar intentos, un código de seis dígitos
 * se adivina probando, y el TTL no lo impide porque un millón de intentos caben de sobra en diez
 * minutos.
 */
export async function up({ context: queryInterface }: MigrationContext): Promise<void> {
  await queryInterface.sequelize.query(`
ALTER TABLE ${PROFILES}
  ADD COLUMN IF NOT EXISTS contact_code_hash        VARCHAR(200),
  ADD COLUMN IF NOT EXISTS contact_code_expires_at  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS contact_code_attempts    INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS contact_code_sent_at     TIMESTAMPTZ;`);
}

export async function down({ context: queryInterface }: MigrationContext): Promise<void> {
  await queryInterface.sequelize.query(`
ALTER TABLE ${PROFILES}
  DROP COLUMN IF EXISTS contact_code_hash,
  DROP COLUMN IF EXISTS contact_code_expires_at,
  DROP COLUMN IF EXISTS contact_code_attempts,
  DROP COLUMN IF EXISTS contact_code_sent_at;`);
}
