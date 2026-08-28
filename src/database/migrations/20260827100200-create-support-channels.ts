/**
 * @file Migración reversible: evoluciona el esquema PostgreSQL en orden.
 * @business El canal de atención y su transcripción: lo que se dijo, quién lo dijo y en qué orden.
 * @system crea `support.support_channels` y `support_messages`, append-only y con cadena de hash.
 */
import { QueryInterface } from 'sequelize';
import { atlasSchemaFor } from '../domain-schemas.js';

type MigrationContext = { context: QueryInterface };

const SCHEMA = atlasSchemaFor('support_channels');
const TENANTS = `${atlasSchemaFor('tenants')}.tenants`;
const CUSTOMERS = `${atlasSchemaFor('customers')}.customers`;
const PARTNERS = `${atlasSchemaFor('partner_profiles')}.partner_profiles`;
const EVIDENCE = `${atlasSchemaFor('evidence_documents')}.evidence_documents`;

const QUEUES = `${SCHEMA}.support_queues`;
const AGENTS = `${SCHEMA}.support_agent_profiles`;
const CASES = `${SCHEMA}.support_cases`;
const ASSIGNMENTS = `${SCHEMA}.support_assignments`;
const CHANNELS = `${SCHEMA}.support_channels`;
const PARTICIPANTS = `${SCHEMA}.support_channel_participants`;
const MESSAGES = `${SCHEMA}.support_messages`;
const RELATIONS = `${SCHEMA}.support_message_relations`;
const ATTACHMENTS = `${SCHEMA}.support_attachments`;

/**
 * La conversación es EVIDENCIA de lo que se comunicó, no un buffer de pantalla.
 *
 * De ahí las tres decisiones que gobiernan estas tablas: un mensaje confirmado no se edita ni se
 * borra, el orden dentro del canal es determinista, y una corrección es un mensaje NUEVO enlazado
 * al anterior. La alternativa —permitir editar— convierte cualquier reclamo en la palabra de una
 * parte contra un registro que la otra parte pudo cambiar después.
 *
 * ## Por qué `server_sequence` y no `created_at`
 *
 * Dos mensajes pueden compartir milisegundo, y el reloj de un servidor puede retroceder. La
 * secuencia se asigna incrementando `support_channels.last_message_sequence` en la MISMA sentencia
 * que la lee (`UPDATE ... RETURNING`), lo que serializa por fila: dos mensajes simultáneos del
 * cliente y del agente reciben números distintos y consecutivos, siempre. Además es el cursor de
 * paginación: `beforeSequence` no degrada con la longitud de la conversación, y `OFFSET 100000`
 * sobre un chat largo sí.
 *
 * ## Por qué `client_message_id` es único por canal
 *
 * Porque la red móvil boliviana reintenta. Sin esa unicidad, un reintento del cliente duplica su
 * propio mensaje y el agente lee dos veces la misma pregunta; con ella, el segundo INSERT choca y
 * el backend devuelve el mensaje que ya existía. La idempotencia es del cliente, no del servidor:
 * el identificador lo genera quien reintenta.
 *
 * ## Por qué hay `body_text` Y `body_ciphertext`
 *
 * Inmutable no puede significar «guardar para siempre en claro lo que nunca debió escribirse». Si
 * alguien pega un OTP o una contraseña, la vista normal muestra la redacción (`body_text`) y el
 * original queda cifrado (`body_ciphertext`), accesible sólo con autorización y dejando traza. El
 * `content_hash` se calcula SOBRE EL ORIGINAL: así la cadena sigue probando qué se escribió de
 * verdad, aunque casi nadie pueda leerlo. Borrar la fila habría destruido la prueba junto con el
 * secreto.
 *
 * ## Por qué el adjunto tiene su propia tabla y no vive en el mensaje
 *
 * Porque un archivo tiene ciclo de vida propio: se escanea, se clasifica, se bloquea contra borrado
 * (Object Lock) y se retiene con su propia política. Y porque la evidencia sensible —documentos de
 * identidad, extractos— no debe viajar por el chat: para eso está `evidence_document_id`, que
 * enlaza al almacén de evidencia con sus reglas, en vez de crear un segundo almacén sin ellas.
 */
export async function up({ context: queryInterface }: MigrationContext): Promise<void> {
  await queryInterface.sequelize.query(`
CREATE TABLE IF NOT EXISTS ${CHANNELS} (
  _id                          BIGSERIAL PRIMARY KEY,
  _tenant_id                   BIGINT       NOT NULL REFERENCES ${TENANTS}(_id) ON UPDATE CASCADE ON DELETE RESTRICT,
  channel_code                 VARCHAR(60)  NOT NULL,
  -- Un canal puede existir SIN caso: una pregunta que se resuelve en dos frases no merece un
  -- expediente. Y un caso puede tener varios canales a lo largo del tiempo.
  case_id                      BIGINT REFERENCES ${CASES}(_id) ON UPDATE CASCADE ON DELETE RESTRICT,
  channel_type                 VARCHAR(30)  NOT NULL DEFAULT 'CHAT',
  subject_context_type         VARCHAR(30)  NOT NULL,
  subject_customer_id          BIGINT REFERENCES ${CUSTOMERS}(_id) ON UPDATE CASCADE ON DELETE RESTRICT,
  subject_partner_profile_id   BIGINT REFERENCES ${PARTNERS}(_id) ON UPDATE CASCADE ON DELETE RESTRICT,
  status                       VARCHAR(20)  NOT NULL DEFAULT 'REQUESTED',
  queue_id                     BIGINT REFERENCES ${QUEUES}(_id) ON UPDATE CASCADE ON DELETE RESTRICT,
  assigned_agent_profile_id    BIGINT REFERENCES ${AGENTS}(_id) ON UPDATE CASCADE ON DELETE SET NULL,
  requested_at                 TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  opened_at                    TIMESTAMPTZ,
  first_response_at            TIMESTAMPTZ,
  last_activity_at             TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  closed_at                    TIMESTAMPTZ,
  closed_by_actor_id           VARCHAR(64),
  close_reason                 VARCHAR(40),
  -- El contador que asigna el orden. Vive aquí y no en un COUNT() porque contar filas para elegir
  -- el siguiente número es exactamente la carrera que produce dos mensajes con la misma posición.
  last_message_sequence        BIGINT       NOT NULL DEFAULT 0,
  last_message_hash            CHAR(64),
  claim_version                INTEGER      NOT NULL DEFAULT 0,
  locale                       VARCHAR(10)  NOT NULL DEFAULT 'es-BO',
  _created_at                  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  _updated_at                  TIMESTAMPTZ,
  _deleted                     BOOLEAN      NOT NULL DEFAULT FALSE,
  CONSTRAINT uq_support_channel_code UNIQUE (_tenant_id, channel_code),
  CONSTRAINT ck_support_channel_type CHECK (channel_type IN ('CHAT', 'ASYNC_MESSAGING', 'INTERNAL_BRIDGE')),
  CONSTRAINT ck_support_channel_status CHECK (
    status IN ('REQUESTED', 'QUEUED', 'OPEN', 'WAITING_USER', 'WAITING_AGENT', 'CLOSING', 'CLOSED', 'ABANDONED')
  ),
  CONSTRAINT ck_support_channel_close_reason CHECK (
    close_reason IS NULL OR close_reason IN ('USER_ENDED', 'AGENT_ENDED', 'IDLE_TIMEOUT',
      'TRANSFERRED_TO_ASYNC', 'ABUSE_POLICY', 'SYSTEM_FAILURE')
  ),
  CONSTRAINT ck_support_channel_context CHECK (
    subject_context_type IN ('CONSUMER', 'PARTNER_USER', 'PARTNER_ORGANIZATION', 'INTERNAL')
  )
);`);

  await queryInterface.sequelize.query(
    `CREATE INDEX IF NOT EXISTS idx_support_channels__cola
       ON ${CHANNELS} (_tenant_id, queue_id, status, requested_at) WHERE _deleted = FALSE;`,
  );
  await queryInterface.sequelize.query(
    `CREATE INDEX IF NOT EXISTS idx_support_channels__del_caso
       ON ${CHANNELS} (case_id, requested_at DESC) WHERE _deleted = FALSE;`,
  );
  await queryInterface.sequelize.query(
    `CREATE INDEX IF NOT EXISTS idx_support_channels__del_cliente
       ON ${CHANNELS} (_tenant_id, subject_customer_id, status) WHERE _deleted = FALSE;`,
  );

  // La asignación puede ser del caso o de un canal concreto; la FK esperaba a que el canal existiera.
  await queryInterface.sequelize.query(`
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fk_support_assignments_channel'
  ) THEN
    ALTER TABLE ${ASSIGNMENTS}
      ADD CONSTRAINT fk_support_assignments_channel
      FOREIGN KEY (channel_id) REFERENCES ${CHANNELS}(_id) ON UPDATE CASCADE ON DELETE SET NULL;
  END IF;
END $$;`);

  await queryInterface.sequelize.query(`
CREATE TABLE IF NOT EXISTS ${PARTICIPANTS} (
  _id                  BIGSERIAL PRIMARY KEY,
  _tenant_id           BIGINT       NOT NULL REFERENCES ${TENANTS}(_id) ON UPDATE CASCADE ON DELETE RESTRICT,
  channel_id           BIGINT       NOT NULL REFERENCES ${CHANNELS}(_id) ON UPDATE CASCADE ON DELETE RESTRICT,
  actor_type           VARCHAR(30)  NOT NULL,
  actor_id             VARCHAR(64)  NOT NULL,
  agent_profile_id     BIGINT REFERENCES ${AGENTS}(_id) ON UPDATE CASCADE ON DELETE SET NULL,
  role_in_channel      VARCHAR(30)  NOT NULL DEFAULT 'REQUESTER',
  joined_at            TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  left_at              TIMESTAMPTZ,
  join_reason          VARCHAR(200),
  leave_reason         VARCHAR(200),
  _created_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  CONSTRAINT ck_support_participant_role CHECK (
    role_in_channel IN ('REQUESTER', 'AGENT', 'SUPERVISOR', 'SPECIALIST', 'OBSERVER', 'SYSTEM')
  )
);`);

  await queryInterface.sequelize.query(
    `CREATE INDEX IF NOT EXISTS idx_support_participants__canal
       ON ${PARTICIPANTS} (channel_id, joined_at);`,
  );
  // Quién está DENTRO ahora mismo: es la comprobación de autorización de cada mensaje leído.
  await queryInterface.sequelize.query(
    `CREATE UNIQUE INDEX IF NOT EXISTS uq_support_participants__presente
       ON ${PARTICIPANTS} (channel_id, actor_type, actor_id) WHERE left_at IS NULL;`,
  );

  await queryInterface.sequelize.query(`
CREATE TABLE IF NOT EXISTS ${MESSAGES} (
  _id                     BIGSERIAL PRIMARY KEY,
  _tenant_id              BIGINT       NOT NULL REFERENCES ${TENANTS}(_id) ON UPDATE CASCADE ON DELETE RESTRICT,
  channel_id              BIGINT       NOT NULL REFERENCES ${CHANNELS}(_id) ON UPDATE CASCADE ON DELETE RESTRICT,
  server_sequence         BIGINT       NOT NULL,
  client_message_id       VARCHAR(64)  NOT NULL,
  sender_actor_type       VARCHAR(30)  NOT NULL,
  sender_actor_id         VARCHAR(64)  NOT NULL,
  sender_agent_profile_id BIGINT REFERENCES ${AGENTS}(_id) ON UPDATE CASCADE ON DELETE SET NULL,
  message_type            VARCHAR(40)  NOT NULL DEFAULT 'TEXT',
  -- Pública, interna o del sistema. La nota interna comparte tabla con el mensaje porque comparte
  -- transcripción y orden, pero JAMÁS visibilidad: filtrar por esta columna es lo único que separa
  -- «lo que le dijimos» de «lo que anotamos sobre él».
  visibility              VARCHAR(20)  NOT NULL DEFAULT 'PUBLIC',
  body_text               TEXT,
  body_ciphertext         TEXT,
  key_version             VARCHAR(40),
  classification          VARCHAR(20)  NOT NULL DEFAULT 'NORMAL',
  content_hash            CHAR(64)     NOT NULL,
  previous_message_hash   CHAR(64),
  integrity_hash          CHAR(64)     NOT NULL,
  redacted_at             TIMESTAMPTZ,
  redaction_reason        VARCHAR(200),
  correlation_id          VARCHAR(64),
  metadata_json           JSONB,
  created_at              TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_support_message_sequence UNIQUE (channel_id, server_sequence),
  CONSTRAINT uq_support_message_client_id UNIQUE (channel_id, client_message_id),
  CONSTRAINT ck_support_message_visibility CHECK (visibility IN ('PUBLIC', 'INTERNAL', 'SYSTEM')),
  CONSTRAINT ck_support_message_classification CHECK (classification IN ('NORMAL', 'SENSITIVE', 'RESTRICTED')),
  CONSTRAINT ck_support_message_type CHECK (
    message_type IN ('TEXT', 'SYSTEM_EVENT', 'ATTACHMENT', 'IMAGE', 'DOCUMENT', 'FORM_REQUEST',
      'FORM_RESPONSE', 'KNOWLEDGE_REFERENCE', 'CASE_STATUS_UPDATE', 'AGENT_TRANSFER_NOTICE',
      'SECURITY_WARNING', 'INTERNAL_NOTE')
  ),
  -- Un mensaje sin cuerpo legible ni cuerpo cifrado no es un mensaje: es una fila que finge serlo.
  CONSTRAINT ck_support_message_body CHECK (body_text IS NOT NULL OR body_ciphertext IS NOT NULL)
);`);

  await queryInterface.sequelize.query(
    `CREATE INDEX IF NOT EXISTS idx_support_messages__transcripcion
       ON ${MESSAGES} (channel_id, server_sequence DESC);`,
  );

  await queryInterface.sequelize.query(`
CREATE TABLE IF NOT EXISTS ${RELATIONS} (
  _id                  BIGSERIAL PRIMARY KEY,
  _tenant_id           BIGINT       NOT NULL REFERENCES ${TENANTS}(_id) ON UPDATE CASCADE ON DELETE RESTRICT,
  message_id           BIGINT       NOT NULL REFERENCES ${MESSAGES}(_id) ON UPDATE CASCADE ON DELETE RESTRICT,
  related_message_id   BIGINT       NOT NULL REFERENCES ${MESSAGES}(_id) ON UPDATE CASCADE ON DELETE RESTRICT,
  relation_type        VARCHAR(30)  NOT NULL,
  created_by_actor_id  VARCHAR(64),
  _created_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_support_message_relation UNIQUE (message_id, related_message_id, relation_type),
  CONSTRAINT ck_support_message_relation_type CHECK (
    relation_type IN ('CORRECTS', 'REPLIES_TO', 'REFERENCES', 'REDACTS_VIEW_OF')
  ),
  CONSTRAINT ck_support_message_relation_distinct CHECK (message_id <> related_message_id)
);`);

  await queryInterface.sequelize.query(`
CREATE TABLE IF NOT EXISTS ${ATTACHMENTS} (
  _id                       BIGSERIAL PRIMARY KEY,
  _tenant_id                BIGINT       NOT NULL REFERENCES ${TENANTS}(_id) ON UPDATE CASCADE ON DELETE RESTRICT,
  message_id                BIGINT REFERENCES ${MESSAGES}(_id) ON UPDATE CASCADE ON DELETE RESTRICT,
  case_id                   BIGINT REFERENCES ${CASES}(_id) ON UPDATE CASCADE ON DELETE RESTRICT,
  storage_object_key        VARCHAR(400) NOT NULL,
  original_filename         VARCHAR(260) NOT NULL,
  declared_mime             VARCHAR(120),
  detected_mime             VARCHAR(120),
  size_bytes                BIGINT       NOT NULL DEFAULT 0,
  sha256                    CHAR(64),
  malware_scan_status       VARCHAR(20)  NOT NULL DEFAULT 'pending',
  malware_scan_at           TIMESTAMPTZ,
  sensitivity               VARCHAR(20)  NOT NULL DEFAULT 'NORMAL',
  encryption_key_version    VARCHAR(40),
  -- Cuando el archivo es evidencia de un reclamo o de un incidente, se bloquea contra borrado hasta
  -- esta fecha. Nulo no significa «borrable ya»: significa que aún no se declaró evidencia.
  object_lock_until         TIMESTAMPTZ,
  -- La evidencia sensible NO viaja por el chat: se sube por el uploader seguro y aquí queda el
  -- puntero, con las reglas de retención y clasificación del almacén de evidencia.
  evidence_document_id      BIGINT REFERENCES ${EVIDENCE}(_id) ON UPDATE CASCADE ON DELETE SET NULL,
  uploaded_by_actor_type    VARCHAR(30)  NOT NULL,
  uploaded_by_actor_id      VARCHAR(64)  NOT NULL,
  _created_at               TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  _updated_at               TIMESTAMPTZ,
  CONSTRAINT ck_support_attachment_scan CHECK (
    malware_scan_status IN ('pending', 'clean', 'infected', 'failed', 'skipped')
  ),
  CONSTRAINT ck_support_attachment_sensitivity CHECK (sensitivity IN ('NORMAL', 'SENSITIVE', 'RESTRICTED'))
);`);

  await queryInterface.sequelize.query(
    `CREATE INDEX IF NOT EXISTS idx_support_attachments__del_caso
       ON ${ATTACHMENTS} (case_id, _created_at DESC);`,
  );
  await queryInterface.sequelize.query(
    `CREATE INDEX IF NOT EXISTS idx_support_attachments__pendientes_escaneo
       ON ${ATTACHMENTS} (_tenant_id, malware_scan_status) WHERE malware_scan_status = 'pending';`,
  );
}

export async function down({ context: queryInterface }: MigrationContext): Promise<void> {
  await queryInterface.sequelize.query(`DROP TABLE IF EXISTS ${ATTACHMENTS};`);
  await queryInterface.sequelize.query(`DROP TABLE IF EXISTS ${RELATIONS};`);
  await queryInterface.sequelize.query(`DROP TABLE IF EXISTS ${MESSAGES};`);
  await queryInterface.sequelize.query(`DROP TABLE IF EXISTS ${PARTICIPANTS};`);
  await queryInterface.sequelize.query(
    `ALTER TABLE ${ASSIGNMENTS} DROP CONSTRAINT IF EXISTS fk_support_assignments_channel;`,
  );
  await queryInterface.sequelize.query(`DROP TABLE IF EXISTS ${CHANNELS};`);
}
