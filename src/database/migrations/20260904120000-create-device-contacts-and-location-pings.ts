/**
 * @file Migración reversible: evoluciona el esquema PostgreSQL en orden.
 * @business Esta pieza guarda la agenda del dispositivo y el rastro de ubicación que el cliente autoriza al instalar la app.
 * @system crea la ficha completa de cada contacto y la serie temporal de posiciones, ambas atadas a un consentimiento.
 */
import { QueryInterface } from 'sequelize';
import { atlasSchemaFor } from '../domain-schemas.js';

type MigrationContext = { context: QueryInterface };

const CONTACTS = `${atlasSchemaFor('customer_device_contacts')}.customer_device_contacts`;
const PINGS = `${atlasSchemaFor('customer_location_pings')}.customer_location_pings`;

/**
 * Las dos tablas que el modelo NO tenía, y por qué hacían falta las dos.
 *
 * Hasta aquí la agenda del teléfono se resumía en nueve números —`contacts-snapshot` sobre
 * `on_device_computation_runs`— y la ubicación era UNA coordenada: la del domicilio declarado en el
 * alta (`address_gps_observations`) más la que se anota al abrir sesión (`customer_sessions`). Con
 * eso no se puede ni llamar a un contacto ni saber dónde estaba alguien el martes.
 *
 * El producto pasa a pedir las dos cosas EXPLÍCITAMENTE al arrancar la app, y lo que se concede hay
 * que poder guardarlo. Estas dos tablas son ese sitio.
 *
 * ## Lo que cambia respecto al diseño anterior, dicho sin rodeos
 *
 * `on_device_computation_runs.raw_contacts_stored` existía desde el esquema inicial y valía `false`
 * SIEMPRE, por construcción: era el registro de que la agenda no se guardaba. A partir de aquí esa
 * columna puede valer `true`, y su valor deja de ser una constante para pasar a ser un hecho por
 * captura. Quien audite el sistema tiene que poder distinguir las capturas de antes de las de
 * ahora, y esa columna es lo que se lo permite.
 *
 * ## Por qué la PII sigue cifrada aunque ahora se guarde entera
 *
 * Porque las personas de una agenda no son clientes y no consintieron nada. Que el cliente autorice
 * compartirla no convierte a sus contactos en sujetos del tratamiento: sigue siendo dato de un
 * tercero, y se guarda con el mismo sobre criptográfico que la PII del titular
 * (`encryptSecretEnvelope`). En claro sólo viajan los HASHES, que son lo que permite cruzar sin
 * descifrar, y los recuentos.
 */
export async function up({ context: queryInterface }: MigrationContext): Promise<void> {
  await queryInterface.sequelize.query(`
    CREATE TABLE IF NOT EXISTS ${CONTACTS} (
      _id                       BIGSERIAL PRIMARY KEY,
      _tenant_id                BIGINT NOT NULL,
      customer_id               BIGINT NOT NULL,

      -- De qué captura salió esta ficha. Permite reconstruir una sincronización entera y saber con
      -- qué versión del algoritmo del teléfono se leyó.
      computation_run_id        BIGINT,
      device_id                 BIGINT,
      session_id                BIGINT,
      -- El consentimiento que la ampara. Sin él la fila no se puede defender ante nadie.
      consent_id                BIGINT,

      source                    VARCHAR(40) NOT NULL DEFAULT 'device_address_book',

      /*
       * El identificador que el SISTEMA OPERATIVO le da al contacto, hasheado.
       *
       * Se guarda hasheado y no en claro porque en Android es un identificador estable que, cruzado
       * entre dos clientes, revelaría que ambos tienen exportada la misma cuenta de Google. Sirve
       * para lo único que hace falta: reconocer la misma ficha en la siguiente sincronización y
       * actualizarla en vez de duplicarla.
       */
      contact_external_id_hash  VARCHAR(128) NOT NULL,

      -- La ficha, cifrada con sobre. Ninguna de estas columnas es legible sin la llave.
      display_name_encrypted    BYTEA,
      given_name_encrypted      BYTEA,
      family_name_encrypted     BYTEA,
      company_encrypted         BYTEA,
      job_title_encrypted       BYTEA,
      phones_encrypted          BYTEA,
      emails_encrypted          BYTEA,
      addresses_encrypted       BYTEA,

      -- Lo que se puede consultar sin descifrar: hashes para cruzar y recuentos para medir.
      display_name_hash         VARCHAR(128),
      primary_phone_hash        VARCHAR(128),
      primary_phone_last_4      VARCHAR(4),
      /*
       * TODOS los teléfonos de la ficha, hasheados.
       *
       * Un array y no una tabla hija: se consulta siempre entero —«¿alguno de estos números está en
       * la lista de vigilancia?»— y nunca por filas. Con un índice GIN, ese solapamiento es una búsqueda de
       * índice; repartido en una tabla hija serían dos joins para la misma pregunta.
       */
      phone_hashes              TEXT[] NOT NULL DEFAULT '{}',
      email_hashes              TEXT[] NOT NULL DEFAULT '{}',
      phone_count               INTEGER NOT NULL DEFAULT 0,
      email_count               INTEGER NOT NULL DEFAULT 0,
      address_count             INTEGER NOT NULL DEFAULT 0,

      birthday                  DATE,
      is_favorite               BOOLEAN NOT NULL DEFAULT FALSE,
      contact_type              VARCHAR(20) NOT NULL DEFAULT 'person',

      captured_at               TIMESTAMPTZ NOT NULL,
      received_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),

      _created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      _updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      _deleted                  BOOLEAN NOT NULL DEFAULT FALSE,

      CONSTRAINT ck_customer_device_contacts_type CHECK (contact_type IN ('person', 'company', 'unknown')),
      CONSTRAINT ck_customer_device_contacts_counts CHECK (
        phone_count >= 0 AND email_count >= 0 AND address_count >= 0
      ),
      /*
       * El recuento tiene que cuadrar con los hashes que hay al lado.
       *
       * Sin esto, un cliente podría declarar veinte teléfonos y mandar dos hashes, y la señal
       * «cuántos números tiene esta persona en su agenda» se volvería inventable desde el móvil.
       */
      CONSTRAINT ck_customer_device_contacts_phone_count CHECK (phone_count = cardinality(phone_hashes)),
      CONSTRAINT ck_customer_device_contacts_email_count CHECK (email_count = cardinality(email_hashes))
    );
  `);

  /*
   * Una ficha por contacto y por cliente. La segunda sincronización ACTUALIZA, no duplica.
   *
   * Sin este índice, abrir la app cinco veces dejaría cinco copias de cada contacto y cualquier
   * recuento sobre la tabla —cuántos contactos tiene, cuántos comparte con otro expediente— saldría
   * multiplicado por el número de sincronizaciones, que es distinto para cada persona.
   */
  await queryInterface.sequelize.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS ux_customer_device_contacts_identity
      ON ${CONTACTS} (_tenant_id, customer_id, contact_external_id_hash)
      WHERE _deleted = FALSE;
  `);

  await queryInterface.sequelize.query(`
    CREATE INDEX IF NOT EXISTS ix_customer_device_contacts_customer
      ON ${CONTACTS} (_tenant_id, customer_id, _created_at DESC);
  `);

  // El cruce antifraude: «¿este número aparece en la agenda de alguien más?». Es la consulta que
  // justifica guardar los hashes, y sin GIN recorrería la tabla entera.
  await queryInterface.sequelize.query(`
    CREATE INDEX IF NOT EXISTS ix_customer_device_contacts_phone_hashes
      ON ${CONTACTS} USING GIN (phone_hashes);
  `);

  await queryInterface.sequelize.query(`
    CREATE INDEX IF NOT EXISTS ix_customer_device_contacts_primary_phone
      ON ${CONTACTS} (_tenant_id, primary_phone_hash)
      WHERE primary_phone_hash IS NOT NULL AND _deleted = FALSE;
  `);

  /**
   * La serie temporal de posiciones.
   *
   * Append-only y sin `_deleted`: un rastro que se puede editar no sirve para lo que sirve un
   * rastro. Se borra por retención —la política de `retention_policies`—, no por actualización.
   */
  await queryInterface.sequelize.query(`
    CREATE TABLE IF NOT EXISTS ${PINGS} (
      _id                            BIGSERIAL PRIMARY KEY,
      _tenant_id                     BIGINT NOT NULL,
      customer_id                    BIGINT NOT NULL,
      device_id                      BIGINT,
      session_id                     BIGINT,
      consent_id                     BIGINT,

      gps_lat                        NUMERIC(10,7) NOT NULL,
      gps_lng                        NUMERIC(10,7) NOT NULL,
      gps_accuracy_meters            NUMERIC(8,2),
      altitude_meters                NUMERIC(9,2),
      speed_mps                      NUMERIC(7,2),
      heading_degrees                NUMERIC(6,2),

      /*
       * Cómo se capturó. El modo «background» es el que más informa y el que más cuesta defender: dice que
       * el teléfono nos habló con la app cerrada, y sólo puede existir si la persona concedió el
       * permiso «siempre».
       */
      capture_mode                   VARCHAR(20) NOT NULL DEFAULT 'foreground',
      /*
       * Si el sistema operativo declara la posición como simulada.
       *
       * Es señal de fraude de primer orden y la da el propio Android/iOS; ignorarla sería tirar el
       * único dato que distingue a alguien que está en su casa de alguien que dice estarlo.
       */
      is_mocked                      BOOLEAN NOT NULL DEFAULT FALSE,
      battery_level                  NUMERIC(5,2),

      -- Lo calcula el servidor contra el domicilio declarado. Nulo mientras no haya domicilio con
      -- coordenada: es «no se pudo calcular», que no es lo mismo que cero metros.
      distance_to_declared_meters    NUMERIC(12,2),

      captured_at                    TIMESTAMPTZ NOT NULL,
      received_at                    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      _created_at                    TIMESTAMPTZ NOT NULL DEFAULT NOW(),

      CONSTRAINT ck_customer_location_pings_mode CHECK (
        capture_mode IN ('foreground', 'background', 'session_start', 'manual')
      ),
      CONSTRAINT ck_customer_location_pings_lat CHECK (gps_lat BETWEEN -90 AND 90),
      CONSTRAINT ck_customer_location_pings_lng CHECK (gps_lng BETWEEN -180 AND 180)
    );
  `);

  /*
   * Idempotencia del lote.
   *
   * El teléfono acumula posiciones sin red y las reenvía cuando vuelve; el mismo lote puede llegar
   * dos veces. La marca de tiempo de captura del dispositivo identifica la posición de forma
   * natural, así que el reintento choca contra el índice en vez de duplicar el rastro.
   */
  await queryInterface.sequelize.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS ux_customer_location_pings_capture
      ON ${PINGS} (_tenant_id, customer_id, captured_at, capture_mode);
  `);

  await queryInterface.sequelize.query(`
    CREATE INDEX IF NOT EXISTS ix_customer_location_pings_recent
      ON ${PINGS} (_tenant_id, customer_id, captured_at DESC);
  `);
}

export async function down({ context: queryInterface }: MigrationContext): Promise<void> {
  await queryInterface.sequelize.query(`DROP TABLE IF EXISTS ${PINGS};`);
  await queryInterface.sequelize.query(`DROP TABLE IF EXISTS ${CONTACTS};`);
}
