/**
 * @file Migración reversible: evoluciona el esquema PostgreSQL en orden.
 * @business El expediente de soporte: qué pidió alguien, quién lo atendió, qué se prometió y cómo terminó.
 * @system crea `support.support_cases` y su historia append-only, asignaciones, relojes de SLA y resolución.
 */
import { QueryInterface } from 'sequelize';
import { atlasSchemaFor } from '../domain-schemas.js';

type MigrationContext = { context: QueryInterface };

const SCHEMA = atlasSchemaFor('support_cases');
const TENANTS = `${atlasSchemaFor('tenants')}.tenants`;
const CUSTOMERS = `${atlasSchemaFor('customers')}.customers`;
const PARTNERS = `${atlasSchemaFor('partner_profiles')}.partner_profiles`;

const QUEUES = `${SCHEMA}.support_queues`;
const CATEGORIES = `${SCHEMA}.support_case_categories`;
const SLA_POLICIES = `${SCHEMA}.support_sla_policies`;
const AGENTS = `${SCHEMA}.support_agent_profiles`;
const CASES = `${SCHEMA}.support_cases`;
const EVENTS = `${SCHEMA}.support_case_events`;
const ASSIGNMENTS = `${SCHEMA}.support_assignments`;
const CLOCKS = `${SCHEMA}.support_sla_clocks`;
const RESOLUTIONS = `${SCHEMA}.support_resolutions`;
const LINKS = `${SCHEMA}.support_case_links`;
const REFERENCES = `${SCHEMA}.support_case_references`;
const FEEDBACK = `${SCHEMA}.support_case_feedback`;

/**
 * El CASO es el expediente; el chat es sólo un canal.
 *
 * Confundirlos es el error que obliga a reconstruir un sistema de soporte cuando el producto entra
 * en operación real: si el ticket es la conversación, cerrar la ventana cierra el problema, y una
 * caída de conexión se convierte en un caso «resuelto». Aquí el caso vive sin ningún chat, sobrevive
 * a todos los que tenga y guarda su propia historia.
 *
 * ## Por qué la historia es append-only y separada del estado
 *
 * `support_cases` responde «cómo está»; `support_case_events` responde «cómo llegó ahí». La primera
 * se actualiza porque no es evidencia primaria —es una proyección para poder listar y filtrar—; la
 * segunda no se toca nunca. Esa separación es lo que permite que un supervisor demuestre que un
 * caso pasó por cuatro manos en dos horas, aunque hoy figure asignado a una sola persona.
 *
 * Cada evento encadena el hash del anterior (`previous_hash` → `event_hash`). No es criptografía
 * decorativa: es lo que hace DETECTABLE que alguien haya borrado el escalamiento incómodo del medio
 * de la secuencia. Sin la cadena, un DELETE con permisos suficientes no deja rastro alguno.
 *
 * ## Por qué el caso guarda la VERSIÓN de SLA y no el SLA
 *
 * Porque el compromiso se juzga con la promesa vigente el día que se abrió. Guardar el plazo por
 * valor lo congelaría bien pero perdería el porqué; guardar sólo el código de política dejaría que
 * un cambio de configuración «arreglara» retroactivamente los incumplimientos del trimestre pasado.
 * Se guarda el puntero a la versión: el plazo se recalcula igual y la política sigue siendo legible.
 *
 * ## Por qué el sujeto es un contexto y no un `user_id`
 *
 * `subject_context_type` distingue al consumidor, al empleado del comercio y al comercio como
 * empresa. Son tres poblaciones con permisos distintos sobre el mismo expediente: el empleado que
 * abrió el caso lo ve siempre, sus compañeros sólo si la visibilidad lo permite, y el administrador
 * del partner según política. Sin esa columna, «los casos de mi empresa» es una consulta que
 * inevitablemente termina filtrando datos de otro comercio.
 *
 * ## `legal_hold` como columna del expediente
 *
 * Retención y borrado son procesos automáticos; el bloqueo legal es lo único que debe poder
 * detenerlos. Vive en la fila del caso —no en una tabla de políticas aparte— para que ninguna rutina
 * de disposición pueda ejecutarse sin haberlo leído.
 */
export async function up({ context: queryInterface }: MigrationContext): Promise<void> {
  await queryInterface.sequelize.query(`
CREATE TABLE IF NOT EXISTS ${CASES} (
  _id                          BIGSERIAL PRIMARY KEY,
  _tenant_id                   BIGINT       NOT NULL REFERENCES ${TENANTS}(_id) ON UPDATE CASCADE ON DELETE RESTRICT,
  -- Número legible (ATL-SUP-2026-00000123). No es la PK: un identificador que se dicta por teléfono
  -- no debe ser el que las llaves foráneas persiguen, y tampoco debe dejar inferir volúmenes.
  case_number                  VARCHAR(40)  NOT NULL,
  subject_context_type         VARCHAR(30)  NOT NULL,
  subject_customer_id          BIGINT REFERENCES ${CUSTOMERS}(_id) ON UPDATE CASCADE ON DELETE RESTRICT,
  subject_partner_profile_id   BIGINT REFERENCES ${PARTNERS}(_id) ON UPDATE CASCADE ON DELETE RESTRICT,
  opened_by_actor_type         VARCHAR(30)  NOT NULL,
  opened_by_actor_id           VARCHAR(64)  NOT NULL,
  requester_display_name       VARCHAR(160),
  origin_channel               VARCHAR(30)  NOT NULL DEFAULT 'HELP_CENTER',
  case_type                    VARCHAR(40)  NOT NULL,
  domain                       VARCHAR(30)  NOT NULL DEFAULT 'OTHER',
  category_id                  BIGINT REFERENCES ${CATEGORIES}(_id) ON UPDATE CASCADE ON DELETE RESTRICT,
  priority                     VARCHAR(4)   NOT NULL DEFAULT 'P3',
  impact                       VARCHAR(20)  NOT NULL DEFAULT 'INDIVIDUAL',
  urgency                      VARCHAR(20)  NOT NULL DEFAULT 'NORMAL',
  sensitivity                  VARCHAR(20)  NOT NULL DEFAULT 'NORMAL',
  status                       VARCHAR(30)  NOT NULL DEFAULT 'NEW',
  queue_id                     BIGINT REFERENCES ${QUEUES}(_id) ON UPDATE CASCADE ON DELETE RESTRICT,
  current_assignee_agent_id    BIGINT REFERENCES ${AGENTS}(_id) ON UPDATE CASCADE ON DELETE SET NULL,
  title                        VARCHAR(200) NOT NULL,
  -- Dos resúmenes y no uno: lo que el cliente puede leer y lo que el equipo necesita anotar. Un
  -- único campo obliga a elegir entre ser útil internamente o ser publicable, y siempre gana el
  -- primero — con la nota interna acabando en la pantalla del cliente.
  public_summary               TEXT,
  internal_summary             TEXT,
  partner_visibility           VARCHAR(30)  NOT NULL DEFAULT 'PRIVATE_TO_REQUESTER',
  locale                       VARCHAR(10)  NOT NULL DEFAULT 'es-BO',
  -- Contexto técnico de origen (§38): correlation id, versión de app, plataforma, código de error
  -- seguro. Nunca stack traces ni secretos: esto se muestra a agentes, no sólo a ingeniería.
  origin_context_json          JSONB,
  opened_at                    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  triaged_at                   TIMESTAMPTZ,
  first_response_at            TIMESTAMPTZ,
  resolved_at                  TIMESTAMPTZ,
  closed_at                    TIMESTAMPTZ,
  last_activity_at             TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  reopened_count               INTEGER      NOT NULL DEFAULT 0,
  transfer_count               INTEGER      NOT NULL DEFAULT 0,
  escalation_level             INTEGER      NOT NULL DEFAULT 0,
  sla_policy_version_id        BIGINT REFERENCES ${SLA_POLICIES}(_id) ON UPDATE CASCADE ON DELETE RESTRICT,
  retention_class_code         VARCHAR(60)  NOT NULL DEFAULT 'support_general',
  legal_hold                   BOOLEAN      NOT NULL DEFAULT FALSE,
  legal_hold_reason            VARCHAR(400),
  legal_hold_set_at            TIMESTAMPTZ,
  last_event_sequence          BIGINT       NOT NULL DEFAULT 0,
  correlation_id               VARCHAR(64),
  _created_at                  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  _updated_at                  TIMESTAMPTZ,
  _deleted                     BOOLEAN      NOT NULL DEFAULT FALSE,
  CONSTRAINT uq_support_case_number UNIQUE (_tenant_id, case_number),
  CONSTRAINT ck_support_case_context CHECK (
    subject_context_type IN ('CONSUMER', 'PARTNER_USER', 'PARTNER_ORGANIZATION', 'INTERNAL')
  ),
  CONSTRAINT ck_support_case_status CHECK (
    status IN ('NEW', 'TRIAGED', 'ASSIGNED', 'IN_PROGRESS', 'WAITING_CUSTOMER', 'WAITING_INTERNAL',
               'WAITING_PARTNER', 'ESCALATED', 'ON_HOLD', 'RESOLVED', 'CLOSED', 'REOPENED',
               'DUPLICATE', 'CANCELLED')
  ),
  CONSTRAINT ck_support_case_priority CHECK (priority IN ('P1', 'P2', 'P3', 'P4')),
  CONSTRAINT ck_support_case_impact CHECK (
    impact IN ('INDIVIDUAL', 'MULTI_USER', 'PARTNER', 'MULTI_PARTNER', 'REGIONAL', 'PLATFORM_WIDE')
  ),
  CONSTRAINT ck_support_case_urgency CHECK (urgency IN ('LOW', 'NORMAL', 'HIGH', 'CRITICAL')),
  CONSTRAINT ck_support_case_sensitivity CHECK (sensitivity IN ('NORMAL', 'SENSITIVE', 'RESTRICTED')),
  CONSTRAINT ck_support_case_visibility CHECK (
    partner_visibility IN ('PRIVATE_TO_REQUESTER', 'PARTNER_TEAM', 'PARTNER_ADMIN', 'ATLAS_ONLY')
  ),
  -- Un caso de comercio sin comercio, o de consumidor sin cliente, es un expediente que después
  -- nadie puede autorizar: la comprobación va en la base porque la autorización depende de ella.
  CONSTRAINT ck_support_case_subject CHECK (
    (subject_context_type = 'CONSUMER' AND subject_customer_id IS NOT NULL)
    OR (subject_context_type IN ('PARTNER_USER', 'PARTNER_ORGANIZATION') AND subject_partner_profile_id IS NOT NULL)
    OR subject_context_type = 'INTERNAL'
  )
);`);

  await queryInterface.sequelize.query(
    `CREATE INDEX IF NOT EXISTS idx_support_cases__mis_casos
       ON ${CASES} (_tenant_id, subject_customer_id, opened_at DESC) WHERE _deleted = FALSE;`,
  );
  await queryInterface.sequelize.query(
    `CREATE INDEX IF NOT EXISTS idx_support_cases__del_comercio
       ON ${CASES} (_tenant_id, subject_partner_profile_id, opened_at DESC) WHERE _deleted = FALSE;`,
  );
  // La cola de trabajo, tal como la pide la pantalla del agente: por cola, estado y prioridad.
  await queryInterface.sequelize.query(
    `CREATE INDEX IF NOT EXISTS idx_support_cases__cola
       ON ${CASES} (_tenant_id, queue_id, status, priority, opened_at) WHERE _deleted = FALSE;`,
  );
  await queryInterface.sequelize.query(
    `CREATE INDEX IF NOT EXISTS idx_support_cases__asignados
       ON ${CASES} (_tenant_id, current_assignee_agent_id, status, last_activity_at DESC) WHERE _deleted = FALSE;`,
  );

  await queryInterface.sequelize.query(`
CREATE TABLE IF NOT EXISTS ${EVENTS} (
  _id                  BIGSERIAL PRIMARY KEY,
  _tenant_id           BIGINT       NOT NULL REFERENCES ${TENANTS}(_id) ON UPDATE CASCADE ON DELETE RESTRICT,
  case_id              BIGINT       NOT NULL REFERENCES ${CASES}(_id) ON UPDATE CASCADE ON DELETE RESTRICT,
  sequence_number      BIGINT       NOT NULL,
  event_type           VARCHAR(60)  NOT NULL,
  actor_type           VARCHAR(30)  NOT NULL,
  actor_id             VARCHAR(64),
  occurred_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  payload_json         JSONB        NOT NULL DEFAULT '{}'::jsonb,
  -- La cadena: cada evento firma el hash del anterior. Alterar o quitar uno del medio rompe todo lo
  -- que viene después, que es exactamente lo que un borrado silencioso no debería poder evitar.
  previous_hash        CHAR(64),
  event_hash           CHAR(64)     NOT NULL,
  correlation_id       VARCHAR(64),
  causation_id         VARCHAR(64),
  _created_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_support_case_event_sequence UNIQUE (case_id, sequence_number)
);`);

  await queryInterface.sequelize.query(
    `CREATE INDEX IF NOT EXISTS idx_support_case_events__timeline
       ON ${EVENTS} (case_id, sequence_number);`,
  );

  await queryInterface.sequelize.query(`
CREATE TABLE IF NOT EXISTS ${ASSIGNMENTS} (
  _id                       BIGSERIAL PRIMARY KEY,
  _tenant_id                BIGINT       NOT NULL REFERENCES ${TENANTS}(_id) ON UPDATE CASCADE ON DELETE RESTRICT,
  case_id                   BIGINT       NOT NULL REFERENCES ${CASES}(_id) ON UPDATE CASCADE ON DELETE RESTRICT,
  channel_id                BIGINT,
  assignee_type             VARCHAR(20)  NOT NULL DEFAULT 'AGENT',
  assignee_agent_profile_id BIGINT REFERENCES ${AGENTS}(_id) ON UPDATE CASCADE ON DELETE RESTRICT,
  assignee_queue_id         BIGINT REFERENCES ${QUEUES}(_id) ON UPDATE CASCADE ON DELETE RESTRICT,
  assigned_at               TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  released_at               TIMESTAMPTZ,
  assignment_reason         VARCHAR(200) NOT NULL DEFAULT 'auto_routing',
  release_reason            VARCHAR(200),
  assigned_by_actor_id      VARCHAR(64),
  assignment_version        INTEGER      NOT NULL DEFAULT 1,
  _created_at               TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  CONSTRAINT ck_support_assignment_type CHECK (assignee_type IN ('AGENT', 'TEAM')),
  CONSTRAINT ck_support_assignment_target CHECK (
    (assignee_type = 'AGENT' AND assignee_agent_profile_id IS NOT NULL)
    OR (assignee_type = 'TEAM' AND assignee_queue_id IS NOT NULL)
  )
);`);

  await queryInterface.sequelize.query(
    `CREATE INDEX IF NOT EXISTS idx_support_assignments__historial
       ON ${ASSIGNMENTS} (case_id, assigned_at DESC);`,
  );
  // Un caso tiene UNA responsabilidad viva a la vez. El índice parcial lo impone: sin él, una
  // transferencia a medias deja dos agentes creyendo que el caso es suyo.
  await queryInterface.sequelize.query(
    `CREATE UNIQUE INDEX IF NOT EXISTS uq_support_assignments__una_viva
       ON ${ASSIGNMENTS} (case_id) WHERE released_at IS NULL;`,
  );

  await queryInterface.sequelize.query(`
CREATE TABLE IF NOT EXISTS ${CLOCKS} (
  _id                     BIGSERIAL PRIMARY KEY,
  _tenant_id              BIGINT       NOT NULL REFERENCES ${TENANTS}(_id) ON UPDATE CASCADE ON DELETE RESTRICT,
  case_id                 BIGINT       NOT NULL REFERENCES ${CASES}(_id) ON UPDATE CASCADE ON DELETE RESTRICT,
  metric_type             VARCHAR(30)  NOT NULL,
  policy_version_id       BIGINT REFERENCES ${SLA_POLICIES}(_id) ON UPDATE CASCADE ON DELETE RESTRICT,
  started_at              TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  target_at               TIMESTAMPTZ  NOT NULL,
  paused_at               TIMESTAMPTZ,
  total_paused_seconds    INTEGER      NOT NULL DEFAULT 0,
  satisfied_at            TIMESTAMPTZ,
  breached_at             TIMESTAMPTZ,
  state                   VARCHAR(20)  NOT NULL DEFAULT 'RUNNING',
  warned_percents_json    JSONB        NOT NULL DEFAULT '[]'::jsonb,
  _created_at             TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  _updated_at             TIMESTAMPTZ,
  CONSTRAINT uq_support_sla_clock UNIQUE (case_id, metric_type),
  CONSTRAINT ck_support_clock_metric CHECK (
    metric_type IN ('ACKNOWLEDGE', 'FIRST_RESPONSE', 'ASSIGNMENT', 'RESOLUTION', 'CLOSE')
  ),
  CONSTRAINT ck_support_clock_state CHECK (state IN ('RUNNING', 'PAUSED', 'MET', 'BREACHED', 'CANCELLED'))
);`);

  // El barrido del vigilante de SLA: qué relojes corren y ya vencieron. Sin este índice, el job que
  // detecta incumplimientos hace un seq scan de todos los casos de la historia cada minuto.
  await queryInterface.sequelize.query(
    `CREATE INDEX IF NOT EXISTS idx_support_sla_clocks__vencimiento
       ON ${CLOCKS} (_tenant_id, state, target_at) WHERE state IN ('RUNNING', 'PAUSED');`,
  );

  await queryInterface.sequelize.query(`
CREATE TABLE IF NOT EXISTS ${RESOLUTIONS} (
  _id                        BIGSERIAL PRIMARY KEY,
  _tenant_id                 BIGINT       NOT NULL REFERENCES ${TENANTS}(_id) ON UPDATE CASCADE ON DELETE RESTRICT,
  case_id                    BIGINT       NOT NULL REFERENCES ${CASES}(_id) ON UPDATE CASCADE ON DELETE RESTRICT,
  resolution_sequence        INTEGER      NOT NULL DEFAULT 1,
  resolution_code            VARCHAR(60)  NOT NULL,
  root_cause_code            VARCHAR(60)  NOT NULL DEFAULT 'UNKNOWN',
  customer_resolution        TEXT         NOT NULL,
  internal_resolution        TEXT         NOT NULL,
  workaround_description     TEXT,
  resolved_by_agent_id       BIGINT REFERENCES ${AGENTS}(_id) ON UPDATE CASCADE ON DELETE SET NULL,
  resolved_by_actor_id       VARCHAR(64),
  resolved_at                TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  superseded_at              TIMESTAMPTZ,
  _created_at                TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_support_resolution_sequence UNIQUE (case_id, resolution_sequence)
);`);

  await queryInterface.sequelize.query(`
CREATE TABLE IF NOT EXISTS ${LINKS} (
  _id                  BIGSERIAL PRIMARY KEY,
  _tenant_id           BIGINT       NOT NULL REFERENCES ${TENANTS}(_id) ON UPDATE CASCADE ON DELETE RESTRICT,
  case_id              BIGINT       NOT NULL REFERENCES ${CASES}(_id) ON UPDATE CASCADE ON DELETE RESTRICT,
  linked_case_id       BIGINT       NOT NULL REFERENCES ${CASES}(_id) ON UPDATE CASCADE ON DELETE RESTRICT,
  link_type            VARCHAR(40)  NOT NULL,
  note                 VARCHAR(400),
  created_by_actor_id  VARCHAR(64),
  _created_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_support_case_link UNIQUE (case_id, linked_case_id, link_type),
  CONSTRAINT ck_support_case_link_type CHECK (
    link_type IN ('DUPLICATE_OF', 'RELATED_TO', 'CAUSED_BY', 'PARENT_OF', 'CHILD_OF',
                  'FOLLOW_UP_OF', 'PROBLEM_OF', 'SECURITY_INCIDENT_OF')
  ),
  CONSTRAINT ck_support_case_link_distinct CHECK (case_id <> linked_case_id)
);`);

  await queryInterface.sequelize.query(`
CREATE TABLE IF NOT EXISTS ${REFERENCES} (
  _id                  BIGSERIAL PRIMARY KEY,
  _tenant_id           BIGINT       NOT NULL REFERENCES ${TENANTS}(_id) ON UPDATE CASCADE ON DELETE RESTRICT,
  case_id              BIGINT       NOT NULL REFERENCES ${CASES}(_id) ON UPDATE CASCADE ON DELETE RESTRICT,
  -- Se REFERENCIA la entidad de Atlas, no se copia. Una copia envejece y termina contradiciendo al
  -- dominio dueño; el soporte no debe convertirse en una segunda verdad sobre una compra.
  entity_type          VARCHAR(60)  NOT NULL,
  entity_id            VARCHAR(64)  NOT NULL,
  relation_type        VARCHAR(40)  NOT NULL DEFAULT 'ABOUT',
  snapshot_label       VARCHAR(200),
  created_by_actor_id  VARCHAR(64),
  _created_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_support_case_reference UNIQUE (case_id, entity_type, entity_id, relation_type)
);`);

  await queryInterface.sequelize.query(
    `CREATE INDEX IF NOT EXISTS idx_support_case_references__por_entidad
       ON ${REFERENCES} (_tenant_id, entity_type, entity_id);`,
  );

  await queryInterface.sequelize.query(`
CREATE TABLE IF NOT EXISTS ${FEEDBACK} (
  _id                    BIGSERIAL PRIMARY KEY,
  _tenant_id             BIGINT       NOT NULL REFERENCES ${TENANTS}(_id) ON UPDATE CASCADE ON DELETE RESTRICT,
  case_id                BIGINT       NOT NULL REFERENCES ${CASES}(_id) ON UPDATE CASCADE ON DELETE RESTRICT,
  respondent_actor_type  VARCHAR(30)  NOT NULL,
  respondent_actor_id    VARCHAR(64)  NOT NULL,
  csat_score             SMALLINT     NOT NULL,
  effort_score           SMALLINT,
  comment                TEXT,
  submitted_at           TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  _created_at            TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_support_case_feedback UNIQUE (case_id, respondent_actor_type, respondent_actor_id),
  CONSTRAINT ck_support_feedback_csat CHECK (csat_score BETWEEN 1 AND 5),
  CONSTRAINT ck_support_feedback_effort CHECK (effort_score IS NULL OR effort_score BETWEEN 1 AND 7)
);`);
}

export async function down({ context: queryInterface }: MigrationContext): Promise<void> {
  await queryInterface.sequelize.query(`DROP TABLE IF EXISTS ${FEEDBACK};`);
  await queryInterface.sequelize.query(`DROP TABLE IF EXISTS ${REFERENCES};`);
  await queryInterface.sequelize.query(`DROP TABLE IF EXISTS ${LINKS};`);
  await queryInterface.sequelize.query(`DROP TABLE IF EXISTS ${RESOLUTIONS};`);
  await queryInterface.sequelize.query(`DROP TABLE IF EXISTS ${CLOCKS};`);
  await queryInterface.sequelize.query(`DROP TABLE IF EXISTS ${ASSIGNMENTS};`);
  await queryInterface.sequelize.query(`DROP TABLE IF EXISTS ${EVENTS};`);
  await queryInterface.sequelize.query(`DROP TABLE IF EXISTS ${CASES};`);
}
