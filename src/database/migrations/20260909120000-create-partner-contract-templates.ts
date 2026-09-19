/**
 * @file Migración reversible: evoluciona el esquema PostgreSQL en orden.
 * @business Esta pieza preserva la fuente de verdad y la evidencia histórica que soportan decisiones y cumplimiento.
 * @system define migrations para evolucionar, mapear, sembrar o consultar PostgreSQL de forma controlada.
 */
import { QueryInterface } from 'sequelize';
import { ATLAS_SCHEMAS } from '../domain-schemas.js';

type MigrationContext = {
  context: QueryInterface;
};

const SCHEMA = ATLAS_SCHEMAS.PARTNER;
const TABLE = `${SCHEMA}.partner_contract_templates`;

/**
 * El contrato legal que un comercio acepta al afiliarse.
 *
 * ## Qué faltaba
 *
 * La verificación del expediente comprobaba matrícula, representante, QR y correo — todo lo que
 * prueba que el comercio EXISTE y es quien dice. Nada comprobaba que hubiera un contrato bajo el
 * que opere. En la práctica eso significaba habilitar a cobrar a un comercio con el que Atlas no
 * ha pactado por escrito nada: ni la comisión, ni los plazos de liquidación, ni qué pasa con una
 * devolución. `grep defaultContract|plantilla legal` no devolvía nada en ningún repositorio.
 *
 * ## Por qué una plantilla por inquilino y no un contrato por comercio
 *
 * Lo que se fija aquí es el texto POR DEFECTO: el que rige salvo que exista uno negociado. Un
 * contrato particular es un término comercial y su sitio es el ERP, igual que el MDR. Esta tabla
 * responde a una pregunta más simple y anterior: «¿bajo qué texto opera un comercio de este
 * inquilino al que nadie le negoció nada?».
 *
 * ## Las dos reglas del esquema, y por qué
 *
 * 1. **Un solo predeterminado vigente por inquilino** (índice único parcial). Con dos, la respuesta
 *    a «¿cuál rige?» la decide el orden de la consulta, que es la peor forma de decidir un asunto
 *    legal.
 * 2. **El cuerpo no se edita: se versiona.** `version` sube y la fila anterior queda `archived`.
 *    Un contrato es evidencia de a qué se comprometió alguien un día concreto; editarlo en sitio
 *    borraría el texto que un comercio aceptó de verdad y dejaría el expediente afirmando algo que
 *    ya no se puede comprobar. Por eso no hay `UPDATE` del cuerpo en el servicio, sólo alta de
 *    versión nueva.
 */
export async function up({ context: queryInterface }: MigrationContext): Promise<void> {
  await queryInterface.sequelize.query(`
    CREATE TABLE IF NOT EXISTS ${TABLE} (
      _id             BIGSERIAL PRIMARY KEY,
      _tenant_id      BIGINT       NOT NULL,
      template_code   VARCHAR(60)  NOT NULL,
      name            VARCHAR(160) NOT NULL,
      version         INTEGER      NOT NULL DEFAULT 1,
      body            TEXT         NOT NULL,
      status          VARCHAR(20)  NOT NULL DEFAULT 'active',
      is_default      BOOLEAN      NOT NULL DEFAULT false,
      effective_from  TIMESTAMPTZ  NOT NULL DEFAULT CURRENT_TIMESTAMP,
      created_by_internal_user_id BIGINT,
      _created_at     TIMESTAMPTZ  NOT NULL DEFAULT CURRENT_TIMESTAMP,
      _updated_at     TIMESTAMPTZ,
      _deleted        BOOLEAN      NOT NULL DEFAULT false,
      CONSTRAINT partner_contract_templates_status_chk
        CHECK (status IN ('active', 'archived')),
      CONSTRAINT partner_contract_templates_version_chk CHECK (version >= 1)
    )
  `);

  await queryInterface.sequelize.query(
    `COMMENT ON TABLE ${TABLE} IS
     'Texto del contrato bajo el que opera un comercio de este inquilino cuando no hay uno negociado. El cuerpo no se edita: se versiona.'`,
  );

  /*
   * Uno y sólo uno vigente. Parcial sobre `_deleted = false` y `status = active` porque las
   * versiones archivadas conviven a propósito: son la prueba de qué texto regía cada día.
   */
  await queryInterface.sequelize.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS partner_contract_templates_default_uq
      ON ${TABLE} (_tenant_id)
    WHERE is_default = true AND status = 'active' AND _deleted = false
  `);

  await queryInterface.sequelize.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS partner_contract_templates_code_version_uq
      ON ${TABLE} (_tenant_id, template_code, version)
    WHERE _deleted = false
  `);
}

export async function down({ context: queryInterface }: MigrationContext): Promise<void> {
  await queryInterface.sequelize.query(`DROP INDEX IF EXISTS ${SCHEMA}.partner_contract_templates_code_version_uq`);
  await queryInterface.sequelize.query(`DROP INDEX IF EXISTS ${SCHEMA}.partner_contract_templates_default_uq`);
  await queryInterface.sequelize.query(`DROP TABLE IF EXISTS ${TABLE}`);
}
