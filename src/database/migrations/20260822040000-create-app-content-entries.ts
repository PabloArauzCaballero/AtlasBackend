/**
 * @file Migración reversible: evoluciona el esquema PostgreSQL en orden.
 * @business Esta pieza saca del código lo que el cliente lee en la app y lo pone donde se edita.
 * @system crea el catálogo de contenidos de la app: inicio, ayuda, preguntas frecuentes y contacto.
 */
import { QueryInterface } from 'sequelize';
import { atlasSchemaFor } from '../domain-schemas.js';

type MigrationContext = { context: QueryInterface };

const TABLE = `${atlasSchemaFor('app_content_entries')}.app_content_entries`;

/**
 * Todo lo que la app enseña y no es un dato del cliente.
 *
 * ## Qué problema resuelve
 *
 * Las pantallas de bienvenida, el eslogan, las preguntas frecuentes, el teléfono de ayuda y los
 * enlaces a las políticas estaban ESCRITOS EN EL CÓDIGO DE LA APP. Cambiar una frase —o un número de
 * WhatsApp, o una respuesta que confunde a la gente— exigía compilar, firmar y publicar en dos
 * tiendas y esperar a que cada persona actualizara. En un producto financiero eso significa que la
 * versión de las condiciones que ve el cliente depende de cuándo actualizó, que es justo lo que no
 * puede pasar.
 *
 * Aquí el contenido vive en el servidor, se edita desde el portal interno y llega a todo el mundo a
 * la vez.
 *
 * ## Por qué una tabla genérica y no una por pantalla
 *
 * Porque son el mismo objeto: un texto con título, cuerpo y orden, dirigido a una pantalla. Una
 * tabla por pantalla multiplicaría el mismo CRUD, el mismo control de acceso y la misma auditoría
 * por cada sitio donde alguien quiera cambiar una frase, y la siguiente pantalla volvería a empezar
 * de cero. La `surface` dice a qué pantalla va y el `content_key` identifica la pieza dentro de ella.
 *
 * ## Los bullets son datos, no marcado
 *
 * `bullets_json` existe para que las respuestas largas se puedan pintar como lista de verdad —con su
 * icono y su jerarquía— en lugar de como un párrafo con guiones. Quien edita no tiene que saber
 * Markdown para que se vea bien, y la app no tiene que interpretar texto libre para maquetar.
 */
export async function up({ context: queryInterface }: MigrationContext): Promise<void> {
  await queryInterface.sequelize.query(`
    CREATE TABLE IF NOT EXISTS ${TABLE} (
      _id           BIGSERIAL PRIMARY KEY,
      _tenant_id    BIGINT NOT NULL,

      -- A qué pantalla va: 'onboarding', 'home', 'faq', 'help', 'legal', 'profile'.
      surface       VARCHAR(40) NOT NULL,
      -- Qué pieza es dentro de esa pantalla ('paso-1', 'eslogan', 'que-es-atlas'...).
      content_key   VARCHAR(120) NOT NULL,
      locale        VARCHAR(10) NOT NULL DEFAULT 'es-BO',

      title         VARCHAR(200),
      subtitle      VARCHAR(300),
      body_md       TEXT,
      -- Lista de puntos: [{ "text": "...", "icon": "check", "emphasis": true }]
      bullets_json  JSONB,
      -- Lo específico de cada tipo: enlaces, teléfono, icono, imagen.
      metadata_json JSONB,

      -- Acción al final de la pieza: 'whatsapp', 'link', 'screen', 'tour'.
      action_kind   VARCHAR(24),
      action_label  VARCHAR(120),
      action_value  VARCHAR(500),

      display_order INTEGER NOT NULL DEFAULT 100,
      is_active     BOOLEAN NOT NULL DEFAULT TRUE,

      published_at  TIMESTAMPTZ,
      updated_by_internal_user_id BIGINT,

      _created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      _updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      _deleted      BOOLEAN NOT NULL DEFAULT FALSE,

      CONSTRAINT ck_app_content_entries_surface CHECK (
        surface IN ('onboarding', 'home', 'faq', 'help', 'legal', 'profile', 'credit')
      ),
      -- Una acción a medias es un botón que no lleva a ningún sitio.
      CONSTRAINT ck_app_content_entries_action CHECK (
        action_kind IS NULL OR (action_label IS NOT NULL AND action_value IS NOT NULL)
      )
    );
  `);

  await queryInterface.sequelize.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS ux_app_content_entries_key
      ON ${TABLE} (_tenant_id, surface, content_key, locale)
      WHERE _deleted = FALSE;
  `);

  await queryInterface.sequelize.query(`
    CREATE INDEX IF NOT EXISTS ix_app_content_entries_surface
      ON ${TABLE} (_tenant_id, surface, is_active, display_order);
  `);
}

export async function down({ context: queryInterface }: MigrationContext): Promise<void> {
  await queryInterface.sequelize.query(`DROP TABLE IF EXISTS ${TABLE};`);
}
