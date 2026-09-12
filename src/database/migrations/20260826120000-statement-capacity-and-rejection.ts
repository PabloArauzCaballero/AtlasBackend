/**
 * @file Migración reversible: evoluciona el esquema PostgreSQL en orden.
 * @business Esta pieza guarda por qué se rechazó un extracto y cuánta capacidad de pago demostró.
 * @system añade a la revisión de extractos el veredicto del motor y su evaluación de capacidad.
 */
import { QueryInterface } from 'sequelize';
import { atlasSchemaFor } from '../domain-schemas.js';

type MigrationContext = { context: QueryInterface };

const REVIEWS = `${atlasSchemaFor('bank_statement_reviews')}.bank_statement_reviews`;
const LINES = `${atlasSchemaFor('credit_lines')}.credit_lines`;

/**
 * Lo que faltaba para poder DECIR por qué.
 *
 * ## El agujero que cierra en la revisión de extractos
 *
 * La tabla guardaba `rejection_reason` como una cadena de veinte caracteres puesta por el propio
 * backend: `STATEMENT_NOT_READABLE` cuando su lector de expresiones regulares no encontraba
 * suficientes números. Con eso, la app sólo podía decirle al cliente «revisa que el archivo sea el
 * extracto completo», que es lo mismo tanto si el documento era una factura de la luz, como si era
 * un PDF editado, como si cubría un mes en vez de tres. Tres problemas distintos, tres acciones
 * distintas, y un solo mensaje que no sirve para ninguno.
 *
 * Ahora el veredicto lo emite el worker de extractos del motor —que sabe distinguirlos— y estas
 * columnas lo conservan: el código del motor, su categoría de rechazo y el mensaje accionable que
 * se le enseña a la persona.
 *
 * ## Y por qué la capacidad de pago se guarda en columnas
 *
 * Porque son las cifras por las que se filtra, se ordena y se explica. `observed_monthly_income` ya
 * existía y era la suma de todo lo que entró, incluidos los traspasos entre cuentas del propio
 * titular; ahora es el ingreso RECONOCIDO sobre tres meses completos, y a su lado viven la cuota
 * máxima sostenible, las obligaciones con terceros y la banda. La evaluación entera queda en
 * `affordability_json` para poder auditar la resta renglón a renglón.
 */
export async function up({ context: queryInterface }: MigrationContext): Promise<void> {
  await queryInterface.sequelize.query(`
    ALTER TABLE ${REVIEWS}
      -- El veredicto del motor, tal como lo emitió. Se guardan los tres —código
      -- técnico, categoría y mensaje— porque responden a preguntas distintas: el
      -- primero para buscar el caso, el segundo para medir cuál pesa, el tercero
      -- para que la persona sepa qué hacer.
      ADD COLUMN IF NOT EXISTS engine_request_id        VARCHAR(64),
      ADD COLUMN IF NOT EXISTS engine_status            VARCHAR(32),
      ADD COLUMN IF NOT EXISTS engine_error_code        VARCHAR(120),
      ADD COLUMN IF NOT EXISTS rejection_category       VARCHAR(40),
      ADD COLUMN IF NOT EXISTS rejection_message        TEXT,
      ADD COLUMN IF NOT EXISTS review_reason            VARCHAR(40),

      -- Autenticidad del contenedor: si el archivo es el que emitió el banco.
      ADD COLUMN IF NOT EXISTS authenticity_verdict     VARCHAR(16),
      ADD COLUMN IF NOT EXISTS authenticity_score       SMALLINT,

      -- Entidad emisora reconocida. Sirve para explicar el rechazo y para medir
      -- de qué bancos llegan los extractos que el motor todavía no sabe leer.
      ADD COLUMN IF NOT EXISTS institution_code         VARCHAR(16),
      ADD COLUMN IF NOT EXISTS institution_name         VARCHAR(200),

      -- Capacidad de pago.
      ADD COLUMN IF NOT EXISTS affordability_json       JSONB,
      ADD COLUMN IF NOT EXISTS affordability_eligible   BOOLEAN,
      ADD COLUMN IF NOT EXISTS affordability_score      SMALLINT,
      ADD COLUMN IF NOT EXISTS affordability_band       VARCHAR(16),
      ADD COLUMN IF NOT EXISTS months_complete          SMALLINT,
      ADD COLUMN IF NOT EXISTS monthly_obligations      NUMERIC(18, 2),
      ADD COLUMN IF NOT EXISTS max_affordable_installment NUMERIC(18, 2),
      ADD COLUMN IF NOT EXISTS income_stability_score   SMALLINT,
      ADD COLUMN IF NOT EXISTS period_from              DATE,
      ADD COLUMN IF NOT EXISTS period_to                DATE;
  `);

  /*
   * El índice que sostiene «el último extracto CON capacidad calculada» de este cliente.
   *
   * Parcial a propósito: la consulta que lo usa descarta siempre los que no tienen evaluación —un
   * extracto rechazado no borra la capacidad medida con uno anterior— así que un índice sobre toda
   * la tabla guardaría filas que nunca se leen.
   */
  await queryInterface.sequelize.query(`
    CREATE INDEX IF NOT EXISTS bank_statement_reviews_capacity_idx
      ON ${REVIEWS} (_tenant_id, customer_id, _created_at DESC)
      WHERE affordability_score IS NOT NULL AND _deleted = false;
  `);

  await queryInterface.sequelize.query(`
    ALTER TABLE ${LINES}
      -- Lo que el modelo de capacidad PROPUSO, junto a lo que la política aprobó.
      --
      -- Las dos cifras se guardan porque la pregunta con la que se calibra un modelo de crédito es
      -- exactamente la diferencia entre ellas: «¿la política se apartó de la capacidad medida, y
      -- cuánto?». Con sólo el límite aprobado esa pregunta no se puede hacer.
      ADD COLUMN IF NOT EXISTS recommended_limit        NUMERIC(18, 2),
      ADD COLUMN IF NOT EXISTS capacity_json            JSONB,
      ADD COLUMN IF NOT EXISTS relationship_score       SMALLINT,
      ADD COLUMN IF NOT EXISTS relationship_tier        VARCHAR(24),
      ADD COLUMN IF NOT EXISTS capacity_binding         VARCHAR(24),
      ADD COLUMN IF NOT EXISTS capacity_evidence        VARCHAR(16);
  `);
}

export async function down({ context: queryInterface }: MigrationContext): Promise<void> {
  await queryInterface.sequelize.query(`DROP INDEX IF EXISTS bank_statement_reviews_capacity_idx;`);
  await queryInterface.sequelize.query(`
    ALTER TABLE ${REVIEWS}
      DROP COLUMN IF EXISTS engine_request_id,
      DROP COLUMN IF EXISTS engine_status,
      DROP COLUMN IF EXISTS engine_error_code,
      DROP COLUMN IF EXISTS rejection_category,
      DROP COLUMN IF EXISTS rejection_message,
      DROP COLUMN IF EXISTS review_reason,
      DROP COLUMN IF EXISTS authenticity_verdict,
      DROP COLUMN IF EXISTS authenticity_score,
      DROP COLUMN IF EXISTS institution_code,
      DROP COLUMN IF EXISTS institution_name,
      DROP COLUMN IF EXISTS affordability_json,
      DROP COLUMN IF EXISTS affordability_eligible,
      DROP COLUMN IF EXISTS affordability_score,
      DROP COLUMN IF EXISTS affordability_band,
      DROP COLUMN IF EXISTS months_complete,
      DROP COLUMN IF EXISTS monthly_obligations,
      DROP COLUMN IF EXISTS max_affordable_installment,
      DROP COLUMN IF EXISTS income_stability_score,
      DROP COLUMN IF EXISTS period_from,
      DROP COLUMN IF EXISTS period_to;
  `);
  await queryInterface.sequelize.query(`
    ALTER TABLE ${LINES}
      DROP COLUMN IF EXISTS recommended_limit,
      DROP COLUMN IF EXISTS capacity_json,
      DROP COLUMN IF EXISTS relationship_score,
      DROP COLUMN IF EXISTS relationship_tier,
      DROP COLUMN IF EXISTS capacity_binding,
      DROP COLUMN IF EXISTS capacity_evidence;
  `);
}
