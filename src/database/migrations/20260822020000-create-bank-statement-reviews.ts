/**
 * @file Migración reversible: evoluciona el esquema PostgreSQL en orden.
 * @business Esta pieza registra el extracto que el cliente sube para que le recalculen su capacidad de pago.
 * @system crea la cola de revisión de extractos bancarios con su compromiso de plazo.
 */
import { QueryInterface } from 'sequelize';
import { atlasSchemaFor } from '../domain-schemas.js';

type MigrationContext = { context: QueryInterface };

const TABLE = `${atlasSchemaFor('bank_statement_reviews')}.bank_statement_reviews`;

/**
 * El extracto bancario que el cliente sube para que le recalculen la línea.
 *
 * ## Por qué es una cola y no un cálculo inmediato
 *
 * Porque leer un extracto no es instantáneo ni infalible: hay que extraer los movimientos, detectar
 * los rechazos por fondos insuficientes y contrastar que la cuenta es suya. Prometerle al cliente un
 * número en el acto obligaría a inventarlo o a fallar en su cara. Se le promete un plazo —24 horas—
 * y se cumple, que es lo que construye confianza en algo tan sensible como entregar tus movimientos.
 *
 * ## Qué NO guarda esta tabla
 *
 * El extracto. El archivo vive cifrado en el almacén de evidencia y aquí solo queda su referencia.
 * La tabla guarda el HECHO de que se subió, el compromiso de plazo y el resultado; nunca el
 * contenido, que es lo que le prometemos a la persona que no circula.
 */
export async function up({ context: queryInterface }: MigrationContext): Promise<void> {
  await queryInterface.sequelize.query(`
    CREATE TABLE IF NOT EXISTS ${TABLE} (
      _id                     BIGSERIAL PRIMARY KEY,
      _tenant_id              BIGINT NOT NULL,
      customer_id             BIGINT NOT NULL,

      -- Referencia al archivo cifrado. El contenido NO vive aquí.
      evidence_document_id    BIGINT,
      storage_key             VARCHAR(500),

      status                  VARCHAR(24) NOT NULL DEFAULT 'received',

      -- Lo que se le prometió al cliente. Se escribe al recibir, no al resolver: es un compromiso,
      -- no una observación, y sin él «en 24 horas» sería una frase de la pantalla y nada más.
      promised_by             TIMESTAMPTZ NOT NULL,

      -- Lo que se extrajo del extracto y alimenta la política.
      nsf_count               INTEGER,
      observed_monthly_income NUMERIC(18,2),
      observed_monthly_expense NUMERIC(18,2),

      -- La línea que salió del recálculo, si llegó a aplicarse.
      applied_credit_line_id  BIGINT,
      rejection_reason        VARCHAR(200),

      reviewed_by_internal_user_id BIGINT,
      reviewed_at             TIMESTAMPTZ,

      _created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      _updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      _deleted                BOOLEAN NOT NULL DEFAULT FALSE,

      CONSTRAINT ck_bank_statement_reviews_status CHECK (
        status IN ('received', 'processing', 'applied', 'rejected')
      ),
      -- Una revisión aplicada sin línea resultante es un estado que miente: dice que se recalculó
      -- y no deja con qué comprobarlo.
      CONSTRAINT ck_bank_statement_reviews_applied CHECK (
        status <> 'applied' OR applied_credit_line_id IS NOT NULL
      ),
      CONSTRAINT ck_bank_statement_reviews_rejected CHECK (
        status <> 'rejected' OR rejection_reason IS NOT NULL
      )
    );
  `);

  await queryInterface.sequelize.query(`
    CREATE INDEX IF NOT EXISTS ix_bank_statement_reviews_customer
      ON ${TABLE} (_tenant_id, customer_id, _created_at DESC);
  `);

  /*
   * Una sola revisión abierta por cliente.
   *
   * Sin esto, tocar el botón tres veces abriría tres colas y tres promesas de 24 horas para el mismo
   * expediente, y la persona vería tres «en revisión» sin saber cuál es el suyo.
   */
  await queryInterface.sequelize.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS ux_bank_statement_reviews_open
      ON ${TABLE} (_tenant_id, customer_id)
      WHERE status IN ('received', 'processing') AND _deleted = FALSE;
  `);
}

export async function down({ context: queryInterface }: MigrationContext): Promise<void> {
  await queryInterface.sequelize.query(`DROP TABLE IF EXISTS ${TABLE};`);
}
