/**
 * @file Migración reversible: evoluciona el esquema PostgreSQL en orden.
 * @business El cliente avisa que pagó por transferencia y adjunta su comprobante; el comercio lo verifica.
 * @system crea `credit.loan_payment_claims`, el reclamo de pago pendiente de verificación humana.
 */
import { QueryInterface } from 'sequelize';
import { atlasSchemaFor } from '../domain-schemas.js';

type MigrationContext = { context: QueryInterface };

const TABLE = `${atlasSchemaFor('loan_payment_claims')}.loan_payment_claims`;
const SCHEMA = atlasSchemaFor('loan_payments');
const TENANTS = `${atlasSchemaFor('tenants')}.tenants`;
const LOANS = `${SCHEMA}.loans`;
const INSTALLMENTS = `${SCHEMA}.loan_installments`;
const PAYMENTS = `${SCHEMA}.loan_payments`;
const EVIDENCE = `${atlasSchemaFor('evidence_documents')}.evidence_documents`;

/**
 * El dinero de una transferencia no lo ve Atlas: lo ve el comercio en su cuenta.
 *
 * La app ya enseña el QR bancario del comercio y ya deja adjuntar el comprobante, y ya le dice al
 * cliente la verdad —«tu comprobante es evidencia, no confirma el pago por sí solo»—. Lo que
 * faltaba es que ese comprobante llegara a alguien: hoy se queda en el teléfono. El cliente cree
 * que aviso, el comercio nunca se entera, y la cuota sigue venciendo.
 *
 * ## Por qué un RECLAMO y no un pago directo
 *
 * Porque quien afirma haber pagado es una de las dos partes, y la otra es la única que puede
 * comprobarlo mirando su cuenta. Registrar el pago con solo la palabra del cliente convertiría una
 * captura de pantalla en un abono real: cualquiera podría saldar una cuota con una imagen.
 *
 * Un reclamo separa las dos cosas. Nace `pending_verification`, no mueve un centavo, y sólo cuando
 * el comercio dice que ese dinero entró se registra el `loan_payment` de verdad. La transición
 * queda con nombre y fecha, así que después se puede reconstruir quién dio por bueno qué.
 *
 * ## Por qué apunta a una cuota y no solo al préstamo
 *
 * Porque el cliente paga UNA cuota concreta: es la que ve vencer y la que le preocupa. Ligarlo solo
 * al préstamo obligaría a adivinar a cuál imputarlo, y esa adivinanza es justo la que produce
 * discusiones sobre si la mora estaba o no perdonada.
 *
 * ## El comprobante vive donde vive el resto de la evidencia
 *
 * En `evidence_documents`, con su hash, su tipo y su política de retención. Guardar la imagen aquí
 * habría creado un segundo almacén de documentos del cliente sin las reglas del primero.
 */
export async function up({ context: queryInterface }: MigrationContext): Promise<void> {
  await queryInterface.sequelize.query(`
CREATE TABLE IF NOT EXISTS ${TABLE} (
  _id                  BIGSERIAL PRIMARY KEY,
  _tenant_id           BIGINT NOT NULL REFERENCES ${TENANTS}(_id) ON UPDATE CASCADE ON DELETE RESTRICT,
  claim_code           VARCHAR(60)  NOT NULL,
  loan_id              BIGINT NOT NULL REFERENCES ${LOANS}(_id) ON UPDATE CASCADE ON DELETE RESTRICT,
  installment_id       BIGINT NOT NULL REFERENCES ${INSTALLMENTS}(_id) ON UPDATE CASCADE ON DELETE RESTRICT,
  customer_id          BIGINT NOT NULL,
  partner_profile_id   BIGINT,
  claimed_amount       NUMERIC(18,2) NOT NULL,
  currency_code        VARCHAR(3)   NOT NULL DEFAULT 'BOB',
  payer_reference      VARCHAR(160),
  proof_evidence_id    BIGINT REFERENCES ${EVIDENCE}(_id) ON UPDATE CASCADE ON DELETE SET NULL,
  status               VARCHAR(30)  NOT NULL DEFAULT 'pending_verification',
  submitted_at         TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  decided_at           TIMESTAMPTZ,
  decided_by_merchant_user_id BIGINT,
  rejection_reason     VARCHAR(300),
  -- El pago que este reclamo produjo al verificarse. Nulo mientras no se verifique: es lo que
  -- distingue «alguien dice que pago» de «el dinero entro».
  loan_payment_id      BIGINT REFERENCES ${PAYMENTS}(_id) ON UPDATE CASCADE ON DELETE SET NULL,
  _created_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  _updated_at          TIMESTAMPTZ,
  _deleted             BOOLEAN      NOT NULL DEFAULT FALSE,
  CONSTRAINT uq_loan_payment_claim_code UNIQUE (_tenant_id, claim_code),
  CONSTRAINT ck_loan_payment_claim_amount CHECK (claimed_amount > 0),
  CONSTRAINT ck_loan_payment_claim_status
    CHECK (status IN ('pending_verification', 'verified', 'rejected'))
);`);

  // La cola del comercio: lo pendiente de SU expediente, lo primero que se pide.
  await queryInterface.sequelize.query(
    `CREATE INDEX IF NOT EXISTS idx_loan_payment_claims__pendientes
       ON ${TABLE} (_tenant_id, partner_profile_id, status) WHERE _deleted = FALSE;`,
  );
  await queryInterface.sequelize.query(
    `CREATE INDEX IF NOT EXISTS idx_loan_payment_claims__installment
       ON ${TABLE} (_tenant_id, installment_id) WHERE _deleted = FALSE;`,
  );
  // Una cuota no puede tener DOS reclamos esperando a la vez: si no, el comercio ve la misma
  // transferencia dos veces y puede darla por buena dos veces.
  await queryInterface.sequelize.query(
    `CREATE UNIQUE INDEX IF NOT EXISTS uq_loan_payment_claims__uno_pendiente
       ON ${TABLE} (_tenant_id, installment_id)
       WHERE status = 'pending_verification' AND _deleted = FALSE;`,
  );
}

export async function down({ context: queryInterface }: MigrationContext): Promise<void> {
  await queryInterface.sequelize.query(`DROP TABLE IF EXISTS ${TABLE};`);
}
