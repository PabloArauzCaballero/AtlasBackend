/**
 * @file Migración reversible: evoluciona el esquema PostgreSQL en orden.
 * @business Define qué colas de soporte existen, cómo se clasifica un caso, qué se promete y quién atiende.
 * @system crea el schema `support` con sus catálogos versionados y el perfil de los agentes.
 */
import { QueryInterface } from 'sequelize';
import { atlasSchemaFor } from '../domain-schemas.js';

type MigrationContext = { context: QueryInterface };

const SCHEMA = atlasSchemaFor('support_queues');
const TENANTS = `${atlasSchemaFor('tenants')}.tenants`;
const INTERNAL_USERS = `${atlasSchemaFor('internal_users')}.internal_users`;

const QUEUES = `${SCHEMA}.support_queues`;
const SLA_POLICIES = `${SCHEMA}.support_sla_policies`;
const CATEGORIES = `${SCHEMA}.support_case_categories`;
const CANNED = `${SCHEMA}.support_canned_responses`;
const AGENTS = `${SCHEMA}.support_agent_profiles`;
const SKILLS = `${SCHEMA}.support_agent_skills`;

/**
 * Soporte como SERVICIO gobernado, no como una caja de texto conectada a un operador.
 *
 * Esta primera migración no crea ningún expediente: crea las reglas con las que después se abrirá.
 * El orden es deliberado —catálogo antes que caso— porque un caso sin cola, sin categoría y sin
 * política de SLA no es un caso: es un texto libre que nadie puede medir ni escalar.
 *
 * ## Por qué un schema propio y no `case_management`
 *
 * En `case_management` viven los expedientes que Atlas abre SOBRE una persona: revisión manual,
 * fraude, listas de control. Aquí viven los que la persona —o el comercio— abre CONTRA Atlas.
 * Parecen lo mismo y no lo son: quien atiende un reclamo no debe heredar la vista de quien
 * investiga un fraude. Compartir schema habría hecho de esa separación una cuestión de disciplina
 * en cada consulta, en vez de una frontera.
 *
 * ## Por qué la política de SLA se VERSIONA en vez de editarse
 *
 * Porque un caso se juzga con la promesa vigente el día que se abrió. Si el compromiso de primera
 * respuesta pasa de 15 a 30 minutos, los casos de ayer no dejan de estar incumplidos: eso sería
 * reescribir el pasado con una configuración. `support_cases` guarda el `sla_policy_version_id` que
 * se le aplicó, y por eso la política no se corrige — se publica otra versión.
 *
 * ## Por qué la clasificación es jerárquica y no una cadena libre
 *
 * `PAYMENT > PAYMENT_PROOF > NOT_RECOGNIZED` se puede contar, enrutar y convertir en un artículo de
 * conocimiento. «no me reconocen el pago» escrito a mano no se puede contar dos veces igual. La
 * jerarquía se declara con `parent_category_id` y su árbol lleva `catalog_version`, así que
 * reorganizar la taxonomía no borra bajo qué criterio se clasificó lo ya clasificado.
 *
 * ## Por qué la capacidad del agente vive en Postgres y no sólo en Redis
 *
 * La presencia (conectado/ausente) es efímera y puede degradarse sin daño. La CAPACIDAD no: es lo
 * que impide que dos agentes tomen el mismo chat. Se reserva con un `UPDATE ... WHERE
 * active_channel_count < max_concurrent_channels RETURNING`, que en Postgres es un compare-and-set
 * atómico real. Con Redis como única fuente, una caída de Redis convertiría la reserva en una
 * carrera silenciosa: dos agentes, el mismo cliente y ninguna traza de por qué.
 */
export async function up({ context: queryInterface }: MigrationContext): Promise<void> {
  await queryInterface.sequelize.query(`CREATE SCHEMA IF NOT EXISTS "${SCHEMA}";`);

  await queryInterface.sequelize.query(`
CREATE TABLE IF NOT EXISTS ${SLA_POLICIES} (
  _id                             BIGSERIAL PRIMARY KEY,
  _tenant_id                      BIGINT       NOT NULL REFERENCES ${TENANTS}(_id) ON UPDATE CASCADE ON DELETE RESTRICT,
  policy_code                     VARCHAR(60)  NOT NULL,
  version_number                  INTEGER      NOT NULL DEFAULT 1,
  priority                        VARCHAR(4)   NOT NULL,
  status                          VARCHAR(20)  NOT NULL DEFAULT 'active',
  calendar_kind                   VARCHAR(20)  NOT NULL DEFAULT 'business_hours',
  timezone                        VARCHAR(60)  NOT NULL DEFAULT 'America/La_Paz',
  -- Los relojes de §21.1. En minutos y no en horas: P1 se mide en minutos y redondear a horas
  -- haría que el compromiso más exigente sea el único que no se puede expresar.
  acknowledge_target_minutes      INTEGER      NOT NULL,
  first_response_target_minutes   INTEGER      NOT NULL,
  update_interval_minutes         INTEGER      NOT NULL,
  resolution_target_minutes       INTEGER      NOT NULL,
  -- Pausar el reloj es una DECISIÓN de política, no un efecto secundario de un estado. Cuando es
  -- false, esperar al cliente no congela el plazo y el incumplimiento sigue siendo visible.
  pause_on_waiting_customer       BOOLEAN      NOT NULL DEFAULT TRUE,
  pause_on_waiting_partner        BOOLEAN      NOT NULL DEFAULT TRUE,
  pause_on_waiting_internal       BOOLEAN      NOT NULL DEFAULT FALSE,
  warning_percents_json           JSONB        NOT NULL DEFAULT '[50, 80]'::jsonb,
  business_hours_json             JSONB,
  effective_from                  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  effective_to                    TIMESTAMPTZ,
  previous_version_id             BIGINT REFERENCES ${SLA_POLICIES}(_id) ON UPDATE CASCADE ON DELETE SET NULL,
  change_reason                   VARCHAR(400),
  approved_by_internal_user_id    BIGINT,
  approved_at                     TIMESTAMPTZ,
  _created_at                     TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  _updated_at                     TIMESTAMPTZ,
  _deleted                        BOOLEAN      NOT NULL DEFAULT FALSE,
  CONSTRAINT uq_support_sla_policy_version UNIQUE (_tenant_id, policy_code, priority, version_number),
  CONSTRAINT ck_support_sla_priority CHECK (priority IN ('P1', 'P2', 'P3', 'P4')),
  CONSTRAINT ck_support_sla_status CHECK (status IN ('draft', 'active', 'retired')),
  CONSTRAINT ck_support_sla_calendar CHECK (calendar_kind IN ('24x7', 'business_hours')),
  CONSTRAINT ck_support_sla_targets CHECK (
    acknowledge_target_minutes > 0 AND first_response_target_minutes > 0
    AND update_interval_minutes > 0 AND resolution_target_minutes > 0
  )
);`);

  await queryInterface.sequelize.query(
    `CREATE INDEX IF NOT EXISTS idx_support_sla_policies__vigente
       ON ${SLA_POLICIES} (_tenant_id, policy_code, priority, status) WHERE _deleted = FALSE;`,
  );

  await queryInterface.sequelize.query(`
CREATE TABLE IF NOT EXISTS ${QUEUES} (
  _id                       BIGSERIAL PRIMARY KEY,
  _tenant_id                BIGINT       NOT NULL REFERENCES ${TENANTS}(_id) ON UPDATE CASCADE ON DELETE RESTRICT,
  queue_code                VARCHAR(60)  NOT NULL,
  name                      VARCHAR(160) NOT NULL,
  description               VARCHAR(400),
  -- A quién sirve la cola. Es la frontera que impide que un caso de comercio caiga en la cola de
  -- consumidores y que un agente de consumidores lea el expediente de un partner.
  context_type              VARCHAR(30)  NOT NULL DEFAULT 'CONSUMER',
  skills_required_json      JSONB        NOT NULL DEFAULT '[]'::jsonb,
  business_hours_json       JSONB,
  default_priority          VARCHAR(4)   NOT NULL DEFAULT 'P3',
  sla_policy_code           VARCHAR(60),
  overflow_queue_id         BIGINT REFERENCES ${QUEUES}(_id) ON UPDATE CASCADE ON DELETE SET NULL,
  display_order             INTEGER      NOT NULL DEFAULT 100,
  is_active                 BOOLEAN      NOT NULL DEFAULT TRUE,
  _created_at               TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  _updated_at               TIMESTAMPTZ,
  _deleted                  BOOLEAN      NOT NULL DEFAULT FALSE,
  CONSTRAINT uq_support_queue_code UNIQUE (_tenant_id, queue_code),
  CONSTRAINT ck_support_queue_context CHECK (
    context_type IN ('CONSUMER', 'PARTNER_USER', 'PARTNER_ORGANIZATION', 'INTERNAL')
  ),
  CONSTRAINT ck_support_queue_priority CHECK (default_priority IN ('P1', 'P2', 'P3', 'P4'))
);`);

  await queryInterface.sequelize.query(
    `CREATE INDEX IF NOT EXISTS idx_support_queues__activas
       ON ${QUEUES} (_tenant_id, context_type, is_active) WHERE _deleted = FALSE;`,
  );

  await queryInterface.sequelize.query(`
CREATE TABLE IF NOT EXISTS ${CATEGORIES} (
  _id                    BIGSERIAL PRIMARY KEY,
  _tenant_id             BIGINT       NOT NULL REFERENCES ${TENANTS}(_id) ON UPDATE CASCADE ON DELETE RESTRICT,
  category_code          VARCHAR(80)  NOT NULL,
  parent_category_id     BIGINT REFERENCES ${CATEGORIES}(_id) ON UPDATE CASCADE ON DELETE RESTRICT,
  domain                 VARCHAR(30)  NOT NULL,
  default_case_type      VARCHAR(40),
  label                  VARCHAR(160) NOT NULL,
  description            VARCHAR(400),
  audience               VARCHAR(30)  NOT NULL DEFAULT 'CONSUMER',
  -- La sensibilidad viaja con la CATEGORÍA porque se conoce antes que el contenido: un caso de
  -- fraude nace restringido aunque todavía nadie haya escrito una línea en él.
  sensitivity            VARCHAR(20)  NOT NULL DEFAULT 'NORMAL',
  default_queue_id       BIGINT REFERENCES ${QUEUES}(_id) ON UPDATE CASCADE ON DELETE SET NULL,
  default_impact         VARCHAR(20)  NOT NULL DEFAULT 'INDIVIDUAL',
  default_urgency        VARCHAR(20)  NOT NULL DEFAULT 'NORMAL',
  requires_specialist    BOOLEAN      NOT NULL DEFAULT FALSE,
  catalog_version        INTEGER      NOT NULL DEFAULT 1,
  display_order          INTEGER      NOT NULL DEFAULT 100,
  is_active              BOOLEAN      NOT NULL DEFAULT TRUE,
  _created_at            TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  _updated_at            TIMESTAMPTZ,
  _deleted               BOOLEAN      NOT NULL DEFAULT FALSE,
  CONSTRAINT uq_support_category_code UNIQUE (_tenant_id, category_code, catalog_version),
  CONSTRAINT ck_support_category_sensitivity CHECK (sensitivity IN ('NORMAL', 'SENSITIVE', 'RESTRICTED')),
  CONSTRAINT ck_support_category_audience CHECK (
    audience IN ('CONSUMER', 'PARTNER_USER', 'PARTNER_ORGANIZATION', 'INTERNAL', 'ANY')
  ),
  CONSTRAINT ck_support_category_impact CHECK (
    default_impact IN ('INDIVIDUAL', 'MULTI_USER', 'PARTNER', 'MULTI_PARTNER', 'REGIONAL', 'PLATFORM_WIDE')
  ),
  CONSTRAINT ck_support_category_urgency CHECK (default_urgency IN ('LOW', 'NORMAL', 'HIGH', 'CRITICAL'))
);`);

  await queryInterface.sequelize.query(
    `CREATE INDEX IF NOT EXISTS idx_support_categories__arbol
       ON ${CATEGORIES} (_tenant_id, parent_category_id, is_active) WHERE _deleted = FALSE;`,
  );

  await queryInterface.sequelize.query(`
CREATE TABLE IF NOT EXISTS ${CANNED} (
  _id                       BIGSERIAL PRIMARY KEY,
  _tenant_id                BIGINT       NOT NULL REFERENCES ${TENANTS}(_id) ON UPDATE CASCADE ON DELETE RESTRICT,
  response_code             VARCHAR(80)  NOT NULL,
  version_number            INTEGER      NOT NULL DEFAULT 1,
  locale                    VARCHAR(10)  NOT NULL DEFAULT 'es-BO',
  title                     VARCHAR(160) NOT NULL,
  body_md                   TEXT         NOT NULL,
  allowed_variables_json    JSONB        NOT NULL DEFAULT '[]'::jsonb,
  audience                  VARCHAR(30)  NOT NULL DEFAULT 'CONSUMER',
  team_scope                VARCHAR(60),
  status                    VARCHAR(20)  NOT NULL DEFAULT 'published',
  published_at              TIMESTAMPTZ,
  created_by_internal_user_id BIGINT,
  previous_version_id       BIGINT REFERENCES ${CANNED}(_id) ON UPDATE CASCADE ON DELETE SET NULL,
  _created_at               TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  _updated_at               TIMESTAMPTZ,
  _deleted                  BOOLEAN      NOT NULL DEFAULT FALSE,
  CONSTRAINT uq_support_canned_version UNIQUE (_tenant_id, response_code, locale, version_number),
  CONSTRAINT ck_support_canned_status CHECK (status IN ('draft', 'published', 'retired'))
);`);

  await queryInterface.sequelize.query(`
CREATE TABLE IF NOT EXISTS ${AGENTS} (
  _id                        BIGSERIAL PRIMARY KEY,
  _tenant_id                 BIGINT       NOT NULL REFERENCES ${TENANTS}(_id) ON UPDATE CASCADE ON DELETE RESTRICT,
  internal_user_id           BIGINT       NOT NULL REFERENCES ${INTERNAL_USERS}(_id) ON UPDATE CASCADE ON DELETE RESTRICT,
  support_level              VARCHAR(20)  NOT NULL DEFAULT 'L1',
  default_queue_id           BIGINT REFERENCES ${QUEUES}(_id) ON UPDATE CASCADE ON DELETE SET NULL,
  timezone                   VARCHAR(60)  NOT NULL DEFAULT 'America/La_Paz',
  language_codes_json        JSONB        NOT NULL DEFAULT '["es"]'::jsonb,
  employment_status          VARCHAR(30)  NOT NULL DEFAULT 'active',
  -- Capacidad y ocupación, en la MISMA fila. Reservar es un solo UPDATE condicional, y por eso dos
  -- agentes no pueden quedarse con el mismo chat aunque pulsen a la vez.
  max_concurrent_channels    INTEGER      NOT NULL DEFAULT 3,
  active_channel_count       INTEGER      NOT NULL DEFAULT 0,
  presence_state             VARCHAR(20)  NOT NULL DEFAULT 'OFFLINE',
  presence_changed_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  is_active                  BOOLEAN      NOT NULL DEFAULT TRUE,
  _created_at                TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  _updated_at                TIMESTAMPTZ,
  _deleted                   BOOLEAN      NOT NULL DEFAULT FALSE,
  CONSTRAINT uq_support_agent_user UNIQUE (_tenant_id, internal_user_id),
  CONSTRAINT ck_support_agent_level CHECK (
    support_level IN ('L1', 'L2', 'SPECIALIST', 'SUPERVISOR', 'MANAGER')
  ),
  CONSTRAINT ck_support_agent_presence CHECK (
    presence_state IN ('AVAILABLE', 'BUSY', 'AWAY', 'OFFLINE', 'TRAINING', 'WRAP_UP')
  ),
  CONSTRAINT ck_support_agent_capacity CHECK (max_concurrent_channels > 0 AND active_channel_count >= 0)
);`);

  // La consulta del enrutador: quién está disponible, con hueco, en esta cola. Parcial a propósito
  // —sólo agentes vivos— porque es la única población que el enrutador mira.
  await queryInterface.sequelize.query(
    `CREATE INDEX IF NOT EXISTS idx_support_agents__disponibles
       ON ${AGENTS} (_tenant_id, presence_state, active_channel_count)
       WHERE _deleted = FALSE AND is_active = TRUE;`,
  );

  await queryInterface.sequelize.query(`
CREATE TABLE IF NOT EXISTS ${SKILLS} (
  _id                  BIGSERIAL PRIMARY KEY,
  _tenant_id           BIGINT       NOT NULL REFERENCES ${TENANTS}(_id) ON UPDATE CASCADE ON DELETE RESTRICT,
  agent_profile_id     BIGINT       NOT NULL REFERENCES ${AGENTS}(_id) ON UPDATE CASCADE ON DELETE CASCADE,
  skill_code           VARCHAR(60)  NOT NULL,
  competency_level     INTEGER      NOT NULL DEFAULT 1,
  valid_from           TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  valid_until          TIMESTAMPTZ,
  is_active            BOOLEAN      NOT NULL DEFAULT TRUE,
  _created_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  _updated_at          TIMESTAMPTZ,
  _deleted             BOOLEAN      NOT NULL DEFAULT FALSE,
  CONSTRAINT uq_support_agent_skill UNIQUE (_tenant_id, agent_profile_id, skill_code),
  CONSTRAINT ck_support_skill_level CHECK (competency_level BETWEEN 1 AND 5)
);`);

  await queryInterface.sequelize.query(
    `CREATE INDEX IF NOT EXISTS idx_support_agent_skills__por_skill
       ON ${SKILLS} (_tenant_id, skill_code, is_active) WHERE _deleted = FALSE;`,
  );
}

export async function down({ context: queryInterface }: MigrationContext): Promise<void> {
  await queryInterface.sequelize.query(`DROP TABLE IF EXISTS ${SKILLS};`);
  await queryInterface.sequelize.query(`DROP TABLE IF EXISTS ${AGENTS};`);
  await queryInterface.sequelize.query(`DROP TABLE IF EXISTS ${CANNED};`);
  await queryInterface.sequelize.query(`DROP TABLE IF EXISTS ${CATEGORIES};`);
  await queryInterface.sequelize.query(`DROP TABLE IF EXISTS ${QUEUES};`);
  await queryInterface.sequelize.query(`DROP TABLE IF EXISTS ${SLA_POLICIES};`);
}
