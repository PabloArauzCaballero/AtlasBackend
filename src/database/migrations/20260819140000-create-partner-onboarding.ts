/**
 * @file Migración reversible: evoluciona el esquema PostgreSQL en orden.
 * @business Esta pieza preserva la fuente de verdad y la evidencia histórica que soportan decisiones y cumplimiento.
 * @system define migrations para evolucionar, mapear, sembrar o consultar PostgreSQL de forma controlada.
 */
import { QueryInterface } from 'sequelize';
import { atlasSchemaFor } from '../domain-schemas.js';

type MigrationContext = { context: QueryInterface };

const PROFILES = `${atlasSchemaFor('partner_profiles')}.partner_profiles`;
const REPRESENTATIVES = `${atlasSchemaFor('partner_legal_representatives')}.partner_legal_representatives`;
const BRANCHES = `${atlasSchemaFor('partner_branches')}.partner_branches`;
const QR_CODES = `${atlasSchemaFor('partner_qr_codes')}.partner_qr_codes`;
const POS_TERMINALS = `${atlasSchemaFor('partner_pos_terminals')}.partner_pos_terminals`;

/**
 * El expediente verificable del comercio.
 *
 * Hasta aquí el partner tenía un flujo COMERCIAL —un caso con checklist en el ERP— que registra
 * que alguien revisó unos papeles. No emitía ningún código, no consultaba ninguna lista y no
 * dejaba evidencia. El resultado medible: un comprador de 300 Bs pasaba por más verificación que
 * el comercio que le vende a crédito.
 *
 * Estas cinco tablas son la mitad que faltaba. Decisiones que no son obvias:
 *
 * 1. **El QR se guarda como EVIDENCIA, no como un dato copiado.** Se conserva el objeto subido
 *    (`storage_key`) y su `sha256`, no sólo el texto que alguien tecleó. Un QR de cobro dice a qué
 *    cuenta va el dinero: aceptar el número transcrito y tirar la imagen deja el sistema sin nada
 *    que oponer el día que el comercio afirme que él nunca puso esa cuenta. El hash es lo que
 *    permite además detectar que el archivo cambió sin que cambiara la fila.
 *
 * 2. **El QR bancario apunta a una entidad del padrón de ASFI** (`bank_institution_code`, la sigla
 *    del regulador). No es decorativo: un QR de cobro contra una entidad sin licencia vigente es
 *    exactamente el caso que hay que poder frenar, y la sigla es lo que permite cruzarlo con el
 *    padrón sin una tabla de traducción.
 *
 * 3. **El número de cuenta se guarda ENMASCARADO y nunca completo.** Es la misma regla que el
 *    worker de extractos aplica a los suyos: el expediente prueba de quién es la cuenta, no
 *    necesita poder operarla.
 *
 * 4. **Un QR no se edita: se reemplaza.** `status` + `replaced_by_id` conservan el anterior en vez
 *    de sobrescribirlo. Si un cobro salió mal hay que poder reconstruir contra qué QR se cobró ese
 *    día, y un UPDATE en sitio destruye justamente eso.
 *
 * 5. **El POS pertenece a una SUCURSAL, no al comercio.** Un terminal está físicamente en un sitio;
 *    colgarlo del comercio haría imposible responder «¿en qué local se hizo este cobro?», que es la
 *    primera pregunta de cualquier investigación de fraude presencial.
 *
 * 6. **El serial del terminal es único por tenant y no por sucursal.** Mover un POS de local es
 *    normal; que el mismo serial exista dos veces a la vez no lo es, y sería la forma más simple de
 *    duplicar cobros sin que nada lo delate.
 */
export async function up({ context: queryInterface }: MigrationContext): Promise<void> {
  await queryInterface.sequelize.query(`CREATE SCHEMA IF NOT EXISTS "partner";`);

  await queryInterface.sequelize.query(`
CREATE TABLE IF NOT EXISTS ${PROFILES} (
  _id                          BIGSERIAL PRIMARY KEY,
  _tenant_id                   BIGINT        NOT NULL,
  legal_name                   VARCHAR(200)  NOT NULL,
  trade_name                   VARCHAR(200),
  -- NIT boliviano. Único por tenant: dos expedientes del mismo NIT son el mismo negocio, y
  -- permitirlos deja dos verificaciones que pueden contradecirse.
  tax_id                       VARCHAR(40)   NOT NULL,
  commercial_registry          VARCHAR(60),
  business_category            VARCHAR(80),
  contact_email                VARCHAR(180)  NOT NULL,
  contact_phone                VARCHAR(40),
  email_verified_at            TIMESTAMPTZ,
  phone_verified_at            TIMESTAMPTZ,
  -- draft → contact_verified → documents_submitted → under_review → approved | rejected
  onboarding_status            VARCHAR(30)   NOT NULL DEFAULT 'draft',
  submitted_at                 TIMESTAMPTZ,
  decided_at                   TIMESTAMPTZ,
  decided_by_internal_user_id  BIGINT,
  rejection_reason             VARCHAR(200),
  -- Puntero a la cuenta B2B del ERP, cuando ya existe. Nulo mientras el expediente va por delante
  -- de la ficha comercial, que es el orden normal: primero se verifica, después se contrata.
  erp_account_id               VARCHAR(64),
  _created_at                  TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  _updated_at                  TIMESTAMPTZ,
  _deleted                     BOOLEAN       NOT NULL DEFAULT false
);`);

  await queryInterface.sequelize.query(`
CREATE UNIQUE INDEX IF NOT EXISTS partner_profiles_tenant_tax_id_key
  ON ${PROFILES} (_tenant_id, tax_id) WHERE _deleted = false;`);
  await queryInterface.sequelize.query(`
CREATE INDEX IF NOT EXISTS partner_profiles_tenant_status_idx
  ON ${PROFILES} (_tenant_id, onboarding_status);`);

  await queryInterface.sequelize.query(`
CREATE TABLE IF NOT EXISTS ${REPRESENTATIVES} (
  _id                     BIGSERIAL PRIMARY KEY,
  _tenant_id              BIGINT        NOT NULL,
  partner_profile_id      BIGINT        NOT NULL REFERENCES ${PROFILES}(_id) ON DELETE CASCADE,
  full_name               VARCHAR(200)  NOT NULL,
  document_type           VARCHAR(20)   NOT NULL,
  document_number         VARCHAR(60)   NOT NULL,
  -- El poder que lo acredita. Sin él, «representante legal» es una afirmación de la propia empresa.
  power_of_attorney_key   VARCHAR(400),
  verified_at             TIMESTAMPTZ,
  _created_at             TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  _updated_at             TIMESTAMPTZ
);`);
  await queryInterface.sequelize.query(`
CREATE INDEX IF NOT EXISTS partner_legal_representatives_profile_idx
  ON ${REPRESENTATIVES} (_tenant_id, partner_profile_id);`);

  await queryInterface.sequelize.query(`
CREATE TABLE IF NOT EXISTS ${BRANCHES} (
  _id                  BIGSERIAL PRIMARY KEY,
  _tenant_id           BIGINT        NOT NULL,
  partner_profile_id   BIGINT        NOT NULL REFERENCES ${PROFILES}(_id) ON DELETE CASCADE,
  branch_code          VARCHAR(40)   NOT NULL,
  name                 VARCHAR(200)  NOT NULL,
  address_line         VARCHAR(300),
  city                 VARCHAR(120),
  latitude             NUMERIC(10, 7),
  longitude            NUMERIC(10, 7),
  status               VARCHAR(20)   NOT NULL DEFAULT 'active',
  erp_branch_id        VARCHAR(64),
  _created_at          TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  _updated_at          TIMESTAMPTZ
);`);
  await queryInterface.sequelize.query(`
CREATE UNIQUE INDEX IF NOT EXISTS partner_branches_profile_code_key
  ON ${BRANCHES} (_tenant_id, partner_profile_id, branch_code);`);

  await queryInterface.sequelize.query(`
CREATE TABLE IF NOT EXISTS ${QR_CODES} (
  _id                    BIGSERIAL PRIMARY KEY,
  _tenant_id             BIGINT        NOT NULL,
  partner_profile_id     BIGINT        NOT NULL REFERENCES ${PROFILES}(_id) ON DELETE CASCADE,
  -- Nulo = QR de toda la empresa. Con sucursal = el QR de ese local.
  branch_id              BIGINT        REFERENCES ${BRANCHES}(_id) ON DELETE CASCADE,
  qr_kind                VARCHAR(20)   NOT NULL,
  storage_key            VARCHAR(400)  NOT NULL,
  content_type           VARCHAR(60)   NOT NULL,
  size_bytes             INTEGER       NOT NULL,
  sha256                 CHAR(64)      NOT NULL,
  -- Sólo para el QR bancario: sigla ASFI de la entidad y cuenta ENMASCARADA.
  bank_institution_code  VARCHAR(16),
  account_number_masked  VARCHAR(40),
  status                 VARCHAR(20)   NOT NULL DEFAULT 'pending_review',
  verified_at            TIMESTAMPTZ,
  replaced_by_id         BIGINT        REFERENCES ${QR_CODES}(_id) ON DELETE SET NULL,
  _created_at            TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  _updated_at            TIMESTAMPTZ
);`);

  // El QR bancario sin entidad no se puede cruzar con el padrón de ASFI, que es lo único que
  // permite frenar un cobro contra una entidad sin licencia. El del negocio no la lleva.
  await queryInterface.sequelize.query(`
ALTER TABLE ${QR_CODES}
  ADD CONSTRAINT partner_qr_codes_entidad_del_qr_bancario
  CHECK (qr_kind <> 'bank' OR bank_institution_code IS NOT NULL);`);
  await queryInterface.sequelize.query(`
ALTER TABLE ${QR_CODES}
  ADD CONSTRAINT partner_qr_codes_tipo_conocido
  CHECK (qr_kind IN ('business', 'bank'));`);

  /*
   * Un solo QR ACTIVO por tipo y por ámbito. Es la restricción que impide el estado que nadie
   * detecta mirando la pantalla: dos QR bancarios vigentes a la vez, cada uno apuntando a una
   * cuenta distinta, sin forma de saber cuál cobró. El índice es parcial porque los reemplazados
   * sí conviven — conservarlos es justamente el punto.
   */
  await queryInterface.sequelize.query(`
CREATE UNIQUE INDEX IF NOT EXISTS partner_qr_codes_activo_por_ambito_key
  ON ${QR_CODES} (_tenant_id, partner_profile_id, qr_kind, COALESCE(branch_id, 0))
  WHERE status = 'active';`);
  await queryInterface.sequelize.query(`
CREATE INDEX IF NOT EXISTS partner_qr_codes_profile_idx
  ON ${QR_CODES} (_tenant_id, partner_profile_id, qr_kind, status);`);

  await queryInterface.sequelize.query(`
CREATE TABLE IF NOT EXISTS ${POS_TERMINALS} (
  _id                  BIGSERIAL PRIMARY KEY,
  _tenant_id           BIGINT        NOT NULL,
  partner_profile_id   BIGINT        NOT NULL REFERENCES ${PROFILES}(_id) ON DELETE CASCADE,
  branch_id            BIGINT        NOT NULL REFERENCES ${BRANCHES}(_id) ON DELETE CASCADE,
  terminal_serial      VARCHAR(80)   NOT NULL,
  terminal_alias       VARCHAR(120),
  provider             VARCHAR(80),
  model                VARCHAR(80),
  status               VARCHAR(20)   NOT NULL DEFAULT 'registered',
  activated_at         TIMESTAMPTZ,
  last_seen_at         TIMESTAMPTZ,
  _created_at          TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  _updated_at          TIMESTAMPTZ
);`);
  await queryInterface.sequelize.query(`
ALTER TABLE ${POS_TERMINALS}
  ADD CONSTRAINT partner_pos_terminals_estado_conocido
  CHECK (status IN ('registered', 'active', 'suspended', 'retired'));`);
  // Único por TENANT y no por sucursal: mover un POS de local es normal, que el mismo serial
  // exista dos veces a la vez no lo es. Los retirados quedan fuera para poder dar de alta un
  // terminal reacondicionado con el mismo serial.
  await queryInterface.sequelize.query(`
CREATE UNIQUE INDEX IF NOT EXISTS partner_pos_terminals_serial_key
  ON ${POS_TERMINALS} (_tenant_id, terminal_serial) WHERE status <> 'retired';`);
  await queryInterface.sequelize.query(`
CREATE INDEX IF NOT EXISTS partner_pos_terminals_branch_idx
  ON ${POS_TERMINALS} (_tenant_id, branch_id, status);`);

  /*
   * Privilegios del rol de aplicación sobre el schema nuevo.
   *
   * Sin esto la migración pasa, el arranque pasa, el type-check pasa — y la primera petición real
   * responde 500 con «permission denied for schema partner», porque las tablas las crea el rol
   * migrador y `atlas_app_rw` no hereda nada. Lo descubre levantar la API y llamarla; ningún gate
   * estático lo ve.
   *
   * `DEFAULT PRIVILEGES` es la mitad que se olvida: sin él, la tabla que añada la PRÓXIMA
   * migración vuelve a nacer sin permisos y el fallo reaparece meses después, ya en producción.
   */
  await queryInterface.sequelize.query(`
    REVOKE CREATE ON SCHEMA "partner" FROM PUBLIC;
    DO $$
    BEGIN
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'atlas_app_rw') THEN
        GRANT USAGE ON SCHEMA "partner" TO atlas_app_rw;
        GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA "partner" TO atlas_app_rw;
        GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA "partner" TO atlas_app_rw;
        ALTER DEFAULT PRIVILEGES IN SCHEMA "partner"
          GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO atlas_app_rw;
        ALTER DEFAULT PRIVILEGES IN SCHEMA "partner"
          GRANT USAGE, SELECT ON SEQUENCES TO atlas_app_rw;
      END IF;
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'atlas_app_ro') THEN
        REVOKE ALL ON ALL TABLES IN SCHEMA "partner" FROM atlas_app_ro;
        REVOKE ALL ON ALL SEQUENCES IN SCHEMA "partner" FROM atlas_app_ro;
      END IF;
    END$$;
  `);
}

export async function down({ context: queryInterface }: MigrationContext): Promise<void> {
  // En orden inverso a las dependencias: los QR referencian sucursales y perfil.
  await queryInterface.sequelize.query(`DROP TABLE IF EXISTS ${POS_TERMINALS};`);
  await queryInterface.sequelize.query(`DROP TABLE IF EXISTS ${QR_CODES};`);
  await queryInterface.sequelize.query(`DROP TABLE IF EXISTS ${BRANCHES};`);
  await queryInterface.sequelize.query(`DROP TABLE IF EXISTS ${REPRESENTATIVES};`);
  await queryInterface.sequelize.query(`DROP TABLE IF EXISTS ${PROFILES};`);
  // El schema NO se borra: puede haber quedado algo más dentro, y un DROP SCHEMA CASCADE en una
  // bajada es la clase de línea que destruye datos que nadie pidió destruir.
}
