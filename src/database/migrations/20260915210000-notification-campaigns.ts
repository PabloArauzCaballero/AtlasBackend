/**
 * @file Migración reversible: evoluciona el esquema PostgreSQL en orden.
 * @business Operaciones programa campañas de notificación con fecha, vigencia, segmento y canales.
 * @system crea `notification_campaigns` y `notification_audience_segments`, y añade a
 *   `notification_messages` la campaña de origen y el fin de vigencia. Sólo DDL: no escribe datos.
 */
import { QueryInterface } from 'sequelize';
import { atlasSchemaFor } from '../domain-schemas.js';

type MigrationContext = { context: QueryInterface };

const SCHEMA = atlasSchemaFor('notification_campaigns');
const CAMPAIGNS = `${SCHEMA}.notification_campaigns`;
const SEGMENTS = `${atlasSchemaFor('notification_audience_segments')}.notification_audience_segments`;
const MESSAGES = `${atlasSchemaFor('notification_messages')}.notification_messages`;

/*
 * Hasta aquí la única «notificación masiva» era un envío in-app inmediato a todos los clientes, sin
 * fecha, sin vigencia, sin segmento y sin rastro: el resultado volvía una vez en la respuesta HTTP y
 * se perdía. La campaña es la unidad que faltaba.
 *
 * La audiencia se guarda COPIADA en la campaña al programar (`audience_definition_json`), no como
 * referencia viva al segmento: editar un segmento mañana no puede cambiar a quién le llegó la campaña
 * de ayer. `audience_segment_id` queda sólo como procedencia.
 *
 * El índice único parcial de mensajes por (campaña, destinatario, canal) es lo que hace idempotente
 * la materialización: una tanda que se repite tras un reinicio no duplica avisos.
 */
export async function up({ context: queryInterface }: MigrationContext): Promise<void> {
  await queryInterface.sequelize.query(`
CREATE TABLE IF NOT EXISTS ${SEGMENTS} (
  _id BIGSERIAL PRIMARY KEY,
  _tenant_id BIGINT NOT NULL,
  name VARCHAR(140) NOT NULL,
  description VARCHAR(400),
  definition_json JSONB NOT NULL,
  last_estimate_json JSONB,
  last_estimated_at TIMESTAMPTZ,
  status VARCHAR(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
  created_by VARCHAR(120),
  _created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  _updated_at TIMESTAMPTZ
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_notification_audience_segments_active_name
  ON ${SEGMENTS} (_tenant_id, lower(name)) WHERE status = 'active';

CREATE TABLE IF NOT EXISTS ${CAMPAIGNS} (
  _id BIGSERIAL PRIMARY KEY,
  _tenant_id BIGINT NOT NULL,
  campaign_uuid UUID NOT NULL UNIQUE,
  name VARCHAR(140) NOT NULL,
  purpose VARCHAR(20) NOT NULL CHECK (purpose IN ('marketing', 'operational')),
  status VARCHAR(20) NOT NULL CHECK (status IN ('draft', 'scheduled', 'running', 'paused', 'completed', 'cancelled', 'failed')),
  title VARCHAR(200) NOT NULL,
  body TEXT NOT NULL,
  category VARCHAR(60) NOT NULL,
  icon VARCHAR(60),
  deep_link VARCHAR(300),
  channels JSONB NOT NULL DEFAULT '["in_app"]'::jsonb,
  audience_segment_id BIGINT,
  audience_definition_json JSONB NOT NULL,
  audience_estimate_json JSONB,
  starts_at TIMESTAMPTZ,
  ends_at TIMESTAMPTZ,
  timezone VARCHAR(60) NOT NULL DEFAULT 'America/La_Paz',
  rate_per_minute INTEGER NOT NULL DEFAULT 600 CHECK (rate_per_minute > 0),
  max_recipients INTEGER CHECK (max_recipients IS NULL OR max_recipients > 0),
  audience_cursor VARCHAR(40),
  materialized_at TIMESTAMPTZ,
  targeted_count INTEGER NOT NULL DEFAULT 0,
  created_count INTEGER NOT NULL DEFAULT 0,
  created_by VARCHAR(120),
  scheduled_by VARCHAR(120),
  scheduled_at TIMESTAMPTZ,
  started_at TIMESTAMPTZ,
  paused_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ,
  cancelled_at TIMESTAMPTZ,
  cancel_reason VARCHAR(400),
  last_error VARCHAR(400),
  idempotency_key VARCHAR(180),
  _created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  _updated_at TIMESTAMPTZ,
  CHECK (ends_at IS NULL OR starts_at IS NULL OR ends_at > starts_at)
);
CREATE INDEX IF NOT EXISTS ix_notification_campaigns_status_starts ON ${CAMPAIGNS} (status, starts_at);
CREATE INDEX IF NOT EXISTS ix_notification_campaigns_tenant_created ON ${CAMPAIGNS} (_tenant_id, _created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS ux_notification_campaigns_idempotency
  ON ${CAMPAIGNS} (_tenant_id, idempotency_key) WHERE idempotency_key IS NOT NULL;

ALTER TABLE ${MESSAGES}
  ADD COLUMN IF NOT EXISTS campaign_id BIGINT,
  ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS ix_notification_messages_campaign_status
  ON ${MESSAGES} (campaign_id, status, scheduled_at) WHERE campaign_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS ux_notification_messages_campaign_recipient
  ON ${MESSAGES} (campaign_id, recipient_type, recipient_id, channel) WHERE campaign_id IS NOT NULL;
`);
}

export async function down({ context: queryInterface }: MigrationContext): Promise<void> {
  await queryInterface.sequelize.query(`
DROP INDEX IF EXISTS ${atlasSchemaFor('notification_messages')}.ux_notification_messages_campaign_recipient;
DROP INDEX IF EXISTS ${atlasSchemaFor('notification_messages')}.ix_notification_messages_campaign_status;
ALTER TABLE ${MESSAGES}
  DROP COLUMN IF EXISTS expires_at,
  DROP COLUMN IF EXISTS campaign_id;
DROP TABLE IF EXISTS ${CAMPAIGNS};
DROP TABLE IF EXISTS ${SEGMENTS};
`);
}
