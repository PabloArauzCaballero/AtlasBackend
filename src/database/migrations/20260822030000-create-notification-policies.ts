/**
 * @file Migración reversible: evoluciona el esquema PostgreSQL en orden.
 * @business Esta pieza decide qué avisos puede apagar el cliente y cuáles no, y quién lo configura.
 * @system crea el catálogo de políticas de notificación por evento y canal, editable por tenant.
 */
import { QueryInterface } from 'sequelize';
import { atlasSchemaFor } from '../domain-schemas.js';

type MigrationContext = { context: QueryInterface };

const TABLE = `${atlasSchemaFor('notification_policies')}.notification_policies`;

/**
 * Qué avisos existen, cómo se llaman de cara al cliente y cuáles son obligatorios.
 *
 * ## El agujero que cierra
 *
 * `user_notification_preferences` ya tenía `is_required` y el repositorio ya se negaba a apagar lo
 * requerido. Pero ese flag llegaba **en el cuerpo de la petición**: era la propia app del cliente
 * quien declaraba si un aviso era obligatorio. Bastaba con crear la preferencia enviando
 * `isRequired: false` para poder apagar el recordatorio de pago y el aviso de mora — exactamente los
 * dos que no se pueden apagar. El control existía y no controlaba nada.
 *
 * A partir de aquí la obligatoriedad la dice ESTA tabla, del lado del servidor, y la petición del
 * cliente sólo puede decir «lo quiero encendido» o «lo quiero apagado».
 *
 * ## Por qué es una tabla y no una constante
 *
 * Porque qué avisos manda un producto de crédito, cómo se le explican al cliente y cuáles son
 * irrenunciables es una decisión de negocio y de cumplimiento, no de ingeniería: cambia por país,
 * por regulador y por campaña. En el código obligaría a un despliegue para cambiar una frase; en
 * esta tabla lo edita quien tiene que editarlo desde el portal interno, y queda con fecha y autor.
 *
 * ## Por qué el aviso de mora no se puede apagar
 *
 * Porque no es marketing: es la comunicación de una consecuencia económica que ya está corriendo.
 * Dejar que alguien silencie el aviso de que está en mora sería dejar que silencie la deuda que
 * sigue creciendo, y el perjuicio recae sobre quien apagó el aviso creyendo que apagaba un ruido.
 * Lo mismo con el recordatorio: existe para evitar la mora, no para vender nada.
 */
export async function up({ context: queryInterface }: MigrationContext): Promise<void> {
  await queryInterface.sequelize.query(`
    CREATE TABLE IF NOT EXISTS ${TABLE} (
      _id             BIGSERIAL PRIMARY KEY,
      _tenant_id      BIGINT NOT NULL,

      event_code      VARCHAR(80) NOT NULL,
      channel         VARCHAR(24) NOT NULL,

      -- Cómo se llama el aviso EN LA PANTALLA del cliente. Sin esto la app tendría que traducir
      -- códigos internos, y cada código nuevo exigiría publicar una versión de la app.
      label           VARCHAR(120) NOT NULL,
      description     VARCHAR(400),
      -- Agrupador visual: 'pagos', 'seguridad', 'novedades'. Ordena la pantalla de preferencias.
      category        VARCHAR(40) NOT NULL DEFAULT 'general',
      icon            VARCHAR(40),

      -- Irrenunciable. Es lo que la app pinta como candado y lo que el servidor hace cumplir.
      is_mandatory    BOOLEAN NOT NULL DEFAULT FALSE,
      -- Con qué valor arranca quien nunca tocó la pantalla. Opt-out, no opt-in.
      default_enabled BOOLEAN NOT NULL DEFAULT TRUE,
      -- Por qué es obligatorio, dicho para el cliente. Un candado sin explicación se lee como abuso.
      mandatory_reason VARCHAR(400),

      display_order   INTEGER NOT NULL DEFAULT 100,
      is_active       BOOLEAN NOT NULL DEFAULT TRUE,

      updated_by_internal_user_id BIGINT,

      _created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      _updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      _deleted        BOOLEAN NOT NULL DEFAULT FALSE,

      CONSTRAINT ck_notification_policies_channel CHECK (
        channel IN ('push', 'email', 'sms', 'in_app', 'whatsapp')
      ),
      -- Un aviso obligatorio tiene que venir con su explicación: es la diferencia entre informar de
      -- un deber y limitarse a impedir que lo apaguen.
      CONSTRAINT ck_notification_policies_mandatory_reason CHECK (
        is_mandatory = FALSE OR mandatory_reason IS NOT NULL
      ),
      -- Y no puede arrancar apagado: sería obligatorio y silencioso a la vez.
      CONSTRAINT ck_notification_policies_mandatory_default CHECK (
        is_mandatory = FALSE OR default_enabled = TRUE
      )
    );
  `);

  await queryInterface.sequelize.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS ux_notification_policies_event_channel
      ON ${TABLE} (_tenant_id, event_code, channel)
      WHERE _deleted = FALSE;
  `);

  await queryInterface.sequelize.query(`
    CREATE INDEX IF NOT EXISTS ix_notification_policies_active
      ON ${TABLE} (_tenant_id, is_active, display_order);
  `);
}

export async function down({ context: queryInterface }: MigrationContext): Promise<void> {
  await queryInterface.sequelize.query(`DROP TABLE IF EXISTS ${TABLE};`);
}
