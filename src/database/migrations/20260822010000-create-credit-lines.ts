/**
 * @file Migración reversible: evoluciona el esquema PostgreSQL en orden.
 * @business Esta pieza escribe la línea de crédito que el motor decidió, y por qué es ésa.
 * @system crea el catálogo versionado de líneas de crédito por cliente con su traza al motor.
 */
import { QueryInterface } from 'sequelize';
import { atlasSchemaFor } from '../domain-schemas.js';

type MigrationContext = { context: QueryInterface };

const TABLE = `${atlasSchemaFor('credit_lines')}.credit_lines`;

/**
 * La línea de crédito del cliente, tal y como la decidió el motor.
 *
 * ## Por qué hacía falta una tabla
 *
 * Porque no había ninguna. El «límite aprobado» que veía el cliente era una constante escrita en la
 * app —`DEFAULT_LIMIT = 500_000` centavos, Bs 5.000 para todo el mundo— y el backend no guardaba
 * ningún límite en ningún sitio. Un producto de crédito cuyo límite no está escrito no puede
 * explicar por qué es ése, ni demostrar que no cambió, ni auditarse.
 *
 * ## Por qué es versionada y no una columna del cliente
 *
 * Porque la capacidad de pago CAMBIA —al subir un extracto, al entrar en mora, al pagar— y cada
 * cambio tiene que poder mirarse después: qué decía antes, qué lo movió y con qué ejecución del
 * motor. Sobrescribir una columna deja al cliente preguntando «¿por qué me bajó?» y a Atlas sin la
 * respuesta. El patrón es el de `customer_profile_versions`: la vigente es la que no tiene
 * `valid_until`.
 *
 * ## Qué se guarda del motor, y por qué tanto
 *
 * El límite solo no explica nada. Se guardan también el puntaje, la banda, la cuota máxima asumible,
 * el ingreso disponible con el que se calculó y los motivos: es lo que permite enseñarle a la
 * persona POR QUÉ tiene la línea que tiene. Y la procedencia de cada variable —dato real, derivado o
 * ausente— porque «no tienes buró» y «tu buró es malo» no son lo mismo y no se le pueden presentar
 * igual.
 */
export async function up({ context: queryInterface }: MigrationContext): Promise<void> {
  await queryInterface.sequelize.query(`
    CREATE TABLE IF NOT EXISTS ${TABLE} (
      _id                        BIGSERIAL PRIMARY KEY,
      _tenant_id                 BIGINT NOT NULL,
      customer_id                BIGINT NOT NULL,

      currency_code              VARCHAR(3) NOT NULL DEFAULT 'BOB',

      -- Lo que el cliente puede gastar. Sale de \`approved_credit_limit\` del artefacto.
      approved_limit             NUMERIC(18,2) NOT NULL,
      -- La cuota más alta que su ingreso sostiene, según la política.
      max_affordable_installment NUMERIC(18,2),
      -- Con qué ingreso disponible se calculó: es la cifra que el cliente reconoce como suya.
      disposable_income          NUMERIC(18,2),

      -- El puntaje ATLAS, 0..1000. Es el que se le enseña al cliente en su perfil.
      scoring                    INTEGER,
      credit_risk_score          INTEGER,
      risk_band                  VARCHAR(24),
      pricing_tier               VARCHAR(8),
      annual_percentage_rate     NUMERIC(6,2),
      affordability_score        INTEGER,
      affordability_decision     VARCHAR(16),
      probability_of_default     NUMERIC(6,4),

      -- El desenlace del motor: APPROVED, DECLINED, MANUAL_REVIEW.
      decision_outcome           VARCHAR(32) NOT NULL,
      decision_execution_id      VARCHAR(64),
      artifact_code              VARCHAR(64),
      artifact_version_id        VARCHAR(64),

      -- Los motivos, tal y como los publicó la política: el «por qué» que se le enseña.
      reason_codes_json          JSONB,
      -- Qué variable era dato real, cuál derivada y cuál ausente al decidir.
      provenance_json            JSONB,

      -- Qué disparó el recálculo. Una bajada de línea sin causa visible es indistinguible de un
      -- error, y ésa es la primera pregunta de quien la sufre y de quien la audita.
      calculation_trigger        VARCHAR(32) NOT NULL,

      valid_from                 TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      valid_until                TIMESTAMPTZ,
      supersedes_credit_line_id  BIGINT,

      _created_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      _updated_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      _deleted                   BOOLEAN NOT NULL DEFAULT FALSE,

      CONSTRAINT ck_credit_lines_limit_not_negative CHECK (approved_limit >= 0),
      CONSTRAINT ck_credit_lines_trigger CHECK (
        calculation_trigger IN ('onboarding', 'bank_statement', 'delinquency', 'repayment', 'manual', 'application')
      )
    );
  `);

  await queryInterface.sequelize.query(`
    CREATE INDEX IF NOT EXISTS ix_credit_lines_tenant_customer
      ON ${TABLE} (_tenant_id, customer_id, valid_from DESC);
  `);

  /*
   * Una sola línea VIGENTE por cliente, garantizada por la base y no por el servicio.
   *
   * Dos vigentes a la vez significan dos límites simultáneos para la misma persona, y la app
   * mostraría el que el `ORDER BY` decidiera ese día. Es el tipo de invariante que rompe una carrera
   * entre dos recálculos —el del extracto y el del barrido de mora— sin que nadie lo note.
   */
  await queryInterface.sequelize.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS ux_credit_lines_current
      ON ${TABLE} (_tenant_id, customer_id)
      WHERE valid_until IS NULL AND _deleted = FALSE;
  `);
}

export async function down({ context: queryInterface }: MigrationContext): Promise<void> {
  await queryInterface.sequelize.query(`DROP TABLE IF EXISTS ${TABLE};`);
}
