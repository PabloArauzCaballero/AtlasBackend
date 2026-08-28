/**
 * @file Migración reversible: evoluciona el esquema PostgreSQL en orden.
 * @business Las respuestas que evitan abrir un caso: preguntas frecuentes y base de conocimiento.
 * @system crea `support.knowledge_articles` y sus versiones inmutables con búsqueda en español.
 */
import { QueryInterface } from 'sequelize';
import { atlasSchemaFor } from '../domain-schemas.js';

type MigrationContext = { context: QueryInterface };

const SCHEMA = atlasSchemaFor('knowledge_articles');
const TENANTS = `${atlasSchemaFor('tenants')}.tenants`;
const CATEGORIES = `${SCHEMA}.support_case_categories`;
const ARTICLES = `${SCHEMA}.knowledge_articles`;
const VERSIONS = `${SCHEMA}.knowledge_article_versions`;

/**
 * Un artículo publicado no se edita: se publica otra versión.
 *
 * Parece un capricho de gobernanza y es lo contrario. Una FAQ sobre pagos, mora o crédito es una
 * declaración de la empresa a sus clientes: si se puede editar en caliente, nadie puede probar qué
 * decía el día que alguien la leyó y actuó en consecuencia. Con versiones, el artículo es la
 * identidad estable —el enlace que se comparte— y la versión es el contenido con su aprobador y su
 * fecha.
 *
 * ## Por qué la aprobación está en la versión y no en el artículo
 *
 * Porque lo que se aprueba es un texto concreto, no un título. Un editor de contenido puede
 * redactar la nueva versión de «cómo se calcula tu límite», pero quien la aprueba tiene que ser el
 * dominio dueño: si la aprobación viviera en el artículo, cambiar el texto no volvería a pedirla.
 *
 * ## Por qué la audiencia es una columna y no una convención
 *
 * Hay artículos públicos, artículos para clientes autenticados, artículos para comercios y guías
 * internas que dicen cuándo escalar. Sin `audience` en la fila, la separación queda en manos de
 * cada consulta, y basta olvidarla una vez —en el buscador— para publicar el manual interno.
 *
 * ## Por qué la búsqueda es `tsvector` en español y no un LIKE
 *
 * Porque quien busca escribe «no me llega el codigo» y el artículo dice «no recibo el OTP». Un LIKE
 * no encuentra nada y el usuario abre un caso que no hacía falta: eso es exactamente el ticket que
 * la base de conocimiento existía para evitar. La columna generada mantiene el índice al día sin
 * que ningún código tenga que acordarse de refrescarlo, y `unaccent` no se asume instalado — se usa
 * la configuración `spanish`, que sí viene de serie.
 */
export async function up({ context: queryInterface }: MigrationContext): Promise<void> {
  await queryInterface.sequelize.query(`
CREATE TABLE IF NOT EXISTS ${ARTICLES} (
  _id                     BIGSERIAL PRIMARY KEY,
  _tenant_id              BIGINT       NOT NULL REFERENCES ${TENANTS}(_id) ON UPDATE CASCADE ON DELETE RESTRICT,
  article_key             VARCHAR(120) NOT NULL,
  audience                VARCHAR(30)  NOT NULL DEFAULT 'PUBLIC_CONSUMER',
  category_id             BIGINT REFERENCES ${CATEGORIES}(_id) ON UPDATE CASCADE ON DELETE SET NULL,
  status                  VARCHAR(20)  NOT NULL DEFAULT 'DRAFT',
  current_version_id      BIGINT,
  owner_team              VARCHAR(80)  NOT NULL DEFAULT 'support',
  -- Una FAQ es una vista especializada del artículo, no otra tabla: mismas versiones, misma
  -- aprobación, mismo control de audiencia. Duplicarla habría duplicado también el olvido de revisar.
  is_faq                  BOOLEAN      NOT NULL DEFAULT FALSE,
  is_featured             BOOLEAN      NOT NULL DEFAULT FALSE,
  product_scope           VARCHAR(60),
  review_cycle_days       INTEGER      NOT NULL DEFAULT 180,
  next_review_at          TIMESTAMPTZ,
  helpful_count           INTEGER      NOT NULL DEFAULT 0,
  not_helpful_count       INTEGER      NOT NULL DEFAULT 0,
  display_order           INTEGER      NOT NULL DEFAULT 100,
  _created_at             TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  _updated_at             TIMESTAMPTZ,
  _deleted                BOOLEAN      NOT NULL DEFAULT FALSE,
  CONSTRAINT uq_knowledge_article_key UNIQUE (_tenant_id, article_key),
  CONSTRAINT ck_knowledge_article_audience CHECK (
    audience IN ('PUBLIC_CONSUMER', 'AUTHENTICATED_CONSUMER', 'PARTNER', 'INTERNAL_SUPPORT')
  ),
  CONSTRAINT ck_knowledge_article_status CHECK (
    status IN ('DRAFT', 'IN_REVIEW', 'APPROVED', 'PUBLISHED', 'RETIRED')
  )
);`);

  await queryInterface.sequelize.query(`
CREATE TABLE IF NOT EXISTS ${VERSIONS} (
  _id                          BIGSERIAL PRIMARY KEY,
  _tenant_id                   BIGINT       NOT NULL REFERENCES ${TENANTS}(_id) ON UPDATE CASCADE ON DELETE RESTRICT,
  article_id                   BIGINT       NOT NULL REFERENCES ${ARTICLES}(_id) ON UPDATE CASCADE ON DELETE RESTRICT,
  version_number               INTEGER      NOT NULL,
  locale                       VARCHAR(10)  NOT NULL DEFAULT 'es-BO',
  status                       VARCHAR(20)  NOT NULL DEFAULT 'DRAFT',
  title                        VARCHAR(200) NOT NULL,
  question                     VARCHAR(300),
  short_answer                 VARCHAR(600),
  body_markdown                TEXT         NOT NULL,
  tags_json                    JSONB        NOT NULL DEFAULT '[]'::jsonb,
  canonical_query_terms_json   JSONB        NOT NULL DEFAULT '[]'::jsonb,
  escalate_when                TEXT,
  created_by_internal_user_id  BIGINT,
  reviewed_by_internal_user_id BIGINT,
  approved_by_internal_user_id BIGINT,
  approved_at                  TIMESTAMPTZ,
  published_at                 TIMESTAMPTZ,
  retired_at                   TIMESTAMPTZ,
  change_reason                VARCHAR(400),
  checksum                     CHAR(64)     NOT NULL,
  search_vector                TSVECTOR GENERATED ALWAYS AS (
    to_tsvector('spanish'::regconfig,
      coalesce(title, '') || ' ' || coalesce(question, '') || ' ' ||
      coalesce(short_answer, '') || ' ' || coalesce(body_markdown, ''))
  ) STORED,
  _created_at                  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  _updated_at                  TIMESTAMPTZ,
  CONSTRAINT uq_knowledge_version UNIQUE (article_id, locale, version_number),
  CONSTRAINT ck_knowledge_version_status CHECK (
    status IN ('DRAFT', 'IN_REVIEW', 'APPROVED', 'PUBLISHED', 'RETIRED')
  )
);`);

  await queryInterface.sequelize.query(`
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_knowledge_article_current_version') THEN
    ALTER TABLE ${ARTICLES}
      ADD CONSTRAINT fk_knowledge_article_current_version
      FOREIGN KEY (current_version_id) REFERENCES ${VERSIONS}(_id) ON UPDATE CASCADE ON DELETE SET NULL;
  END IF;
END $$;`);

  await queryInterface.sequelize.query(
    `CREATE INDEX IF NOT EXISTS idx_knowledge_versions__busqueda
       ON ${VERSIONS} USING GIN (search_vector);`,
  );
  // Sólo lo PUBLICADO se ofrece al buscar. El índice parcial deja fuera borradores y retirados, que
  // es donde vive el texto que nadie aprobó.
  await queryInterface.sequelize.query(
    `CREATE INDEX IF NOT EXISTS idx_knowledge_versions__publicadas
       ON ${VERSIONS} (article_id, locale, published_at DESC) WHERE status = 'PUBLISHED';`,
  );
  await queryInterface.sequelize.query(
    `CREATE INDEX IF NOT EXISTS idx_knowledge_articles__catalogo
       ON ${ARTICLES} (_tenant_id, audience, status, display_order) WHERE _deleted = FALSE;`,
  );
}

export async function down({ context: queryInterface }: MigrationContext): Promise<void> {
  await queryInterface.sequelize.query(
    `ALTER TABLE ${ARTICLES} DROP CONSTRAINT IF EXISTS fk_knowledge_article_current_version;`,
  );
  await queryInterface.sequelize.query(`DROP TABLE IF EXISTS ${VERSIONS};`);
  await queryInterface.sequelize.query(`DROP TABLE IF EXISTS ${ARTICLES};`);
}
