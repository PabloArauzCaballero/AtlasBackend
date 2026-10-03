/**
 * @file Migración reversible: evoluciona el esquema PostgreSQL en orden.
 * @business Da a cada cliente una tarjeta (Normal, Silver, Gold, Premium, Black) que gana por su comportamiento y que el personal puede ajustar a mano, con motivo y sin tocar su límite de crédito.
 * @system crea `catalog.card_tiers` (presentación de cada tarjeta, por tenant) y `credit.customer_card_tier_overrides` (ajustes manuales con vigencia y revocación), y siembra las cinco tarjetas.
 */
import { QueryInterface } from 'sequelize';
import { atlasSchemaFor } from '../domain-schemas.js';

type MigrationContext = { context: QueryInterface };

const TENANTS = `${atlasSchemaFor('tenants')}.tenants`;
const CUSTOMERS = `${atlasSchemaFor('customers')}.customers`;
const TIERS = `${atlasSchemaFor('card_tiers')}.card_tiers`;
const OVERRIDES = `${atlasSchemaFor('customer_card_tier_overrides')}.customer_card_tier_overrides`;

const TARJETAS = ['NORMAL', 'SILVER', 'GOLD', 'PREMIUM', 'BLACK'];
const NIVELES = ['NUEVO', 'EN_CONSTRUCCION', 'ESTABLECIDO', 'CONSOLIDADO', 'PREFERENTE'];
const lista = (valores: string[]) => valores.map((valor) => `'${valor}'`).join(', ');

/**
 * Las cinco tarjetas de fábrica. Es la MISMA tabla que `DEFAULT_CARD_TIERS` del dominio (que sirve de respaldo si un
 * tenant no la tiene sembrada); aquí va escrita en línea porque una migración no puede cambiar de contenido cuando
 * cambie el código.
 *
 * Sin ventajas comerciales (`benefits_json` vacío): no se prometen beneficios que el negocio no definió. Se cargan
 * después, desde el catálogo.
 */
const SEMILLA = [
  {
    code: 'NORMAL',
    label: 'Normal',
    level: 'NUEVO',
    order: 1,
    description: 'La tarjeta con la que empiezas. Se mejora pagando a tiempo.',
    theme: { gradient: ['#16314F', '#0C2C50', '#0A2038'], ink: '#E8F4FF', accent: '#5CF0CC', finish: 'azul marino' },
  },
  {
    code: 'SILVER',
    label: 'Silver',
    level: 'EN_CONSTRUCCION',
    order: 2,
    description: 'Ya hay historia contigo: tus primeros pagos cuentan.',
    theme: { gradient: ['#E4E9EF', '#AEB8C4', '#7B8794'], ink: '#10202F', accent: '#FFFFFF', finish: 'plata' },
  },
  {
    code: 'GOLD',
    label: 'Gold',
    level: 'ESTABLECIDO',
    order: 3,
    description: 'Una relación establecida: pagas, cumples y se nota.',
    theme: { gradient: ['#F7E08A', '#D9A93A', '#9C6F14'], ink: '#2A1B02', accent: '#FFF4C2', finish: 'oro' },
  },
  {
    code: 'PREMIUM',
    label: 'Premium',
    level: 'CONSOLIDADO',
    order: 4,
    description: 'Una relación consolidada: tu historial habla por ti.',
    theme: { gradient: ['#2BE0A8', '#14A894', '#0E7377'], ink: '#052033', accent: '#CFFFF0', finish: 'verde esmeralda' },
  },
  {
    code: 'BLACK',
    label: 'Black',
    level: 'PREFERENTE',
    order: 5,
    description: 'El escalón más alto: la confianza más ganada.',
    theme: { gradient: ['#2B2F38', '#14161B', '#050608'], ink: '#F2D98A', accent: '#D9A93A', finish: 'negro con grabado dorado' },
  },
] as const;

export async function up({ context: queryInterface }: MigrationContext): Promise<void> {
  const sql = (consulta: string, opciones?: { replacements: Record<string, unknown> }) =>
    queryInterface.sequelize.query(consulta, opciones);

  await sql(`
CREATE TABLE IF NOT EXISTS ${TIERS} (
  _id            BIGSERIAL PRIMARY KEY,
  _tenant_id     BIGINT       NOT NULL REFERENCES ${TENANTS}(_id) ON UPDATE CASCADE ON DELETE RESTRICT,
  tier_code      VARCHAR(20)  NOT NULL,
  label          VARCHAR(40)  NOT NULL,
  level_code     VARCHAR(30)  NOT NULL,
  display_order  INTEGER      NOT NULL,
  description    VARCHAR(300) NOT NULL DEFAULT '',
  benefits_json  JSONB        NOT NULL DEFAULT '[]'::jsonb,
  theme_json     JSONB        NOT NULL,
  is_active      BOOLEAN      NOT NULL DEFAULT TRUE,
  _created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  _updated_at    TIMESTAMPTZ,
  _deleted       BOOLEAN      NOT NULL DEFAULT FALSE,
  CONSTRAINT uq_card_tiers_code  UNIQUE (_tenant_id, tier_code),
  CONSTRAINT uq_card_tiers_level UNIQUE (_tenant_id, level_code),
  CONSTRAINT ck_card_tiers_code  CHECK (tier_code  IN (${lista(TARJETAS)})),
  CONSTRAINT ck_card_tiers_level CHECK (level_code IN (${lista(NIVELES)})),
  CONSTRAINT ck_card_tiers_benefits_array CHECK (jsonb_typeof(benefits_json) = 'array')
);`);

  await sql(`
CREATE TABLE IF NOT EXISTS ${OVERRIDES} (
  _id                       BIGSERIAL PRIMARY KEY,
  _tenant_id                BIGINT      NOT NULL REFERENCES ${TENANTS}(_id)   ON UPDATE CASCADE ON DELETE RESTRICT,
  customer_id               BIGINT      NOT NULL REFERENCES ${CUSTOMERS}(_id) ON UPDATE CASCADE ON DELETE RESTRICT,
  tier_code                 VARCHAR(20) NOT NULL,
  -- El motivo es obligatorio y con cuerpo: un ajuste manual sin explicación no se puede auditar.
  reason                    TEXT        NOT NULL,
  set_by_internal_user_id   BIGINT,
  valid_from                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at                TIMESTAMPTZ,
  revoked_at                TIMESTAMPTZ,
  revoked_by_internal_user_id BIGINT,
  revoke_reason             TEXT,
  _created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  _deleted                  BOOLEAN     NOT NULL DEFAULT FALSE,
  CONSTRAINT ck_card_overrides_tier   CHECK (tier_code IN (${lista(TARJETAS)})),
  CONSTRAINT ck_card_overrides_reason CHECK (length(btrim(reason)) >= 10),
  CONSTRAINT ck_card_overrides_expiry CHECK (expires_at IS NULL OR expires_at > valid_from),
  CONSTRAINT ck_card_overrides_revoke CHECK (
    (revoked_at IS NULL AND revoke_reason IS NULL AND revoked_by_internal_user_id IS NULL)
    OR (revoked_at IS NOT NULL AND length(btrim(coalesce(revoke_reason, ''))) >= 10)
  )
);`);

  // Una sola tarjeta manual SIN REVOCAR por cliente: dos ajustes a la vez no tendrían cuál mandar. Los vencidos
  // se revocan en el servicio antes de insertar uno nuevo.
  await sql(`
CREATE UNIQUE INDEX IF NOT EXISTS ux_card_overrides_customer_open
  ON ${OVERRIDES} (_tenant_id, customer_id)
  WHERE revoked_at IS NULL AND _deleted = FALSE;`);
  await sql(`CREATE INDEX IF NOT EXISTS ix_card_overrides_customer_history ON ${OVERRIDES} (_tenant_id, customer_id, valid_from DESC);`);

  for (const tarjeta of SEMILLA) {
    await sql(
      `
INSERT INTO ${TIERS} (_tenant_id, tier_code, label, level_code, display_order, description, benefits_json, theme_json)
SELECT t._id, :code, :label, :level, :ord, :description, '[]'::jsonb, CAST(:theme AS JSONB)
FROM ${TENANTS} t
WHERE NOT EXISTS (SELECT 1 FROM ${TIERS} e WHERE e._tenant_id = t._id AND e.tier_code = :code);`,
      {
        replacements: {
          code: tarjeta.code,
          label: tarjeta.label,
          level: tarjeta.level,
          ord: tarjeta.order,
          description: tarjeta.description,
          theme: JSON.stringify(tarjeta.theme),
        },
      },
    );
  }
}

export async function down({ context: queryInterface }: MigrationContext): Promise<void> {
  // El historial de ajustes es evidencia de quién cambió qué y por qué: deshacer la migración lo pierde, y por eso
  // el `down` existe pero es una decisión consciente, no un reflejo.
  await queryInterface.sequelize.query(`DROP TABLE IF EXISTS ${OVERRIDES};`);
  await queryInterface.sequelize.query(`DROP TABLE IF EXISTS ${TIERS};`);
}
