/**
 * @file Migración reversible: evoluciona el esquema PostgreSQL en orden.
 * @business El expediente reúne en un solo sitio los archivos de una persona, con quién puede verlos y qué había el día que se decidió.
 * @system cinco tablas en el schema `expedientes`; ninguna toca las tablas de evidencia, que se referencian.
 */
import { QueryInterface } from 'sequelize';
import { atlasSchemaFor } from '../domain-schemas.js';

type MigrationContext = { context: QueryInterface };

const SCHEMA = atlasSchemaFor('expedientes');
const TENANTS = `${atlasSchemaFor('tenants')}.tenants`;
const INTERNAL_USERS = `${atlasSchemaFor('internal_users')}.internal_users`;
const EVIDENCE = `${atlasSchemaFor('evidence_documents')}.evidence_documents`;

const EXPEDIENTES = `${SCHEMA}.expedientes`;
const NODOS = `${SCHEMA}.expediente_nodos`;
const CONCESIONES = `${SCHEMA}.expediente_concesiones`;
const ACTIVIDAD = `${SCHEMA}.expediente_actividad`;
const TICKETS = `${SCHEMA}.expediente_tickets_subida`;

/**
 * El expediente: la carpeta de un sujeto, sus permisos y su historia.
 *
 * ## Por qué un catálogo y no una copia
 *
 * Los bytes ya están en MinIO y sus claves ya viven en `evidence_documents.s3_key`,
 * `bank_statement_reviews.storage_key` y en cuatro columnas del Motor. Mover un objeto para
 * «ordenarlo» obligaría a actualizar cuatro tablas de DOS bases distintas en una transacción que
 * no existe, y a que los workers que hoy leen por esas claves siguieran encontrándolas.
 *
 * Estas tablas **referencian**: un nodo guarda la clave del objeto y el nombre que se le enseña a
 * una persona. Renombrar y mover son `UPDATE`; nada se copia. La consecuencia es que borrar un
 * nodo NO borra el objeto si otra tabla lo sigue apuntando, y por eso existe el conteo de
 * referencias del servicio.
 *
 * ## Por qué la ruta va materializada
 *
 * `ruta` duplica lo que `parent_id` ya dice. Se guarda porque el árbol se lee mucho más de lo que
 * se mueve: resolver los ancestros de un nodo para heredar permisos es una consulta por prefijo
 * sobre una columna indexada, y no un recorrido recursivo por cada petición. Al mover se recalcula
 * el subárbol entero en la misma transacción.
 */
export async function up({ context: queryInterface }: MigrationContext): Promise<void> {
  await queryInterface.sequelize.query(`CREATE SCHEMA IF NOT EXISTS ${SCHEMA};`);

  await queryInterface.sequelize.query(`
CREATE TABLE IF NOT EXISTS ${EXPEDIENTES} (
  _id                BIGSERIAL PRIMARY KEY,
  _tenant_id         BIGINT      NOT NULL REFERENCES ${TENANTS}(_id) ON UPDATE CASCADE ON DELETE RESTRICT,
  -- El sujeto se declara por tipo + id y NO por una clave foránea a cada tabla posible: hoy es un
  -- cliente, mañana un comercio o un reclamo, y una columna por tipo dejaría la tabla llena de
  -- nulos y de restricciones que sólo aplican a una fila de cada cien.
  subject_type       VARCHAR(30) NOT NULL,
  subject_id         BIGINT      NOT NULL,
  -- La sesión de onboarding que lo creó. Es lo que hace que «un alta» sea la unidad: un cliente que
  -- vuelve a intentarlo abre otro expediente en vez de mezclar dos intentos en la misma carpeta.
  session_id         BIGINT,
  customer_code      VARCHAR(60),
  estado             VARCHAR(20) NOT NULL DEFAULT 'abierto',
  -- Cuándo se congeló. A partir de aquí el manifiesto es citable: «esto era lo que había».
  enviado_en         TIMESTAMPTZ,
  manifest_nodo_id   BIGINT,
  retencion_hasta    TIMESTAMPTZ,
  creado_por_tipo    VARCHAR(20) NOT NULL DEFAULT 'system',
  creado_por_id      BIGINT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  purgado_en         TIMESTAMPTZ,
  CONSTRAINT ck_expedientes__estado CHECK (estado IN ('abierto', 'enviado', 'cerrado', 'purgado')),
  CONSTRAINT ck_expedientes__sujeto CHECK (subject_type IN ('customer', 'partner', 'claim'))
);`);

  // Un expediente por (sujeto, sesión). `COALESCE` porque en SQL dos NULL no son iguales, y sin él
  // un sujeto sin sesión podría acumular expedientes duplicados sin que la base lo impidiera.
  await queryInterface.sequelize.query(
    `CREATE UNIQUE INDEX IF NOT EXISTS ux_expedientes__sujeto_sesion
       ON ${EXPEDIENTES} (_tenant_id, subject_type, subject_id, COALESCE(session_id, 0));`,
  );
  await queryInterface.sequelize.query(
    `CREATE INDEX IF NOT EXISTS idx_expedientes__sujeto ON ${EXPEDIENTES} (_tenant_id, subject_type, subject_id);`,
  );
  await queryInterface.sequelize.query(
    `CREATE INDEX IF NOT EXISTS idx_expedientes__estado ON ${EXPEDIENTES} (_tenant_id, estado, created_at DESC);`,
  );

  await queryInterface.sequelize.query(`
CREATE TABLE IF NOT EXISTS ${NODOS} (
  _id                   BIGSERIAL PRIMARY KEY,
  _tenant_id            BIGINT      NOT NULL REFERENCES ${TENANTS}(_id) ON UPDATE CASCADE ON DELETE RESTRICT,
  expediente_id         BIGINT      NOT NULL REFERENCES ${EXPEDIENTES}(_id) ON UPDATE CASCADE ON DELETE CASCADE,
  parent_id             BIGINT      REFERENCES ${NODOS}(_id) ON UPDATE CASCADE ON DELETE CASCADE,
  tipo                  VARCHAR(10) NOT NULL,
  nombre                VARCHAR(255) NOT NULL,
  -- Materializada: '/auth/anverso.jpg'. Ver la cabecera del archivo.
  ruta                  TEXT        NOT NULL,
  origen                VARCHAR(20) NOT NULL,
  clase                 VARCHAR(30),
  storage_key           TEXT,
  storage_bucket        VARCHAR(120),
  sha256                CHAR(64),
  mime_type             VARCHAR(100),
  size_bytes            BIGINT,
  -- Los dos puentes hacia lo que ya existía. Nulos en un archivo nacido en el portal.
  evidence_document_id  BIGINT REFERENCES ${EVIDENCE}(_id) ON UPDATE CASCADE ON DELETE SET NULL,
  engine_request_id     VARCHAR(64),
  -- Un objeto que la base dice tener y el almacén no. Se marca en vez de esconder la fila: «no está»
  -- y «nunca existió» llevan a acciones distintas.
  objeto_ausente        BOOLEAN     NOT NULL DEFAULT FALSE,
  inmutable             BOOLEAN     NOT NULL DEFAULT FALSE,
  creado_por_tipo       VARCHAR(20) NOT NULL DEFAULT 'system',
  creado_por_id         BIGINT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  borrado_en            TIMESTAMPTZ,
  borrado_por_id        BIGINT,
  CONSTRAINT ck_nodos__tipo CHECK (tipo IN ('carpeta', 'archivo')),
  CONSTRAINT ck_nodos__origen CHECK (origen IN ('onboarding', 'motor', 'portal', 'sistema')),
  /*
   * Un nodo VIRTUAL: aparece en la carpeta como un archivo, y su contenido se compone al pedirlo
   * desde la base en vez de estar guardado en el almacén.
   *
   * Es lo que hace contactos.json. Los contactos —métodos de contacto, referencias declaradas,
   * agregados de la agenda— ya viven en PostgreSQL, algunos cifrados. Copiarlos a un objeto del
   * bucket habría creado una SEGUNDA copia de datos personales con menos controles que la tabla de
   * la que salen, y que además envejece: el archivo diría lo que era cierto el día que se escribió.
   * Sirviéndolo desde la base, lo que se enseña es siempre el dato vigente y el enmascarado se
   * decide en cada petición según quién pregunta.
   */
  virtual               BOOLEAN     NOT NULL DEFAULT FALSE,
  -- Un archivo sin clave y sin ser virtual no es un archivo: sería una fila que promete bytes que
  -- nadie puede leer.
  CONSTRAINT ck_nodos__archivo_con_clave CHECK (tipo = 'carpeta' OR virtual OR storage_key IS NOT NULL)
);`);

  // Unicidad por nombre dentro de la carpeta, insensible a mayúsculas y sólo entre los vivos: la
  // papelera conserva el nombre para poder restaurarlo, y dos borrados del mismo archivo no pueden
  // chocar entre sí.
  await queryInterface.sequelize.query(
    `CREATE UNIQUE INDEX IF NOT EXISTS ux_nodos__nombre_en_carpeta
       ON ${NODOS} (expediente_id, COALESCE(parent_id, 0), lower(nombre))
       WHERE borrado_en IS NULL;`,
  );
  // Dos nodos del mismo expediente no apuntan al mismo objeto: sería el mismo archivo dos veces.
  await queryInterface.sequelize.query(
    `CREATE UNIQUE INDEX IF NOT EXISTS ux_nodos__objeto_en_expediente
       ON ${NODOS} (expediente_id, storage_key)
       WHERE storage_key IS NOT NULL AND borrado_en IS NULL;`,
  );
  await queryInterface.sequelize.query(
    `CREATE INDEX IF NOT EXISTS idx_nodos__carpeta ON ${NODOS} (_tenant_id, expediente_id, parent_id);`,
  );
  // El conteo de referencias pregunta por clave a través de todos los expedientes.
  await queryInterface.sequelize.query(`CREATE INDEX IF NOT EXISTS idx_nodos__clave ON ${NODOS} (storage_key);`);
  // La herencia de permisos resuelve ancestros por prefijo de ruta.
  await queryInterface.sequelize.query(
    `CREATE INDEX IF NOT EXISTS idx_nodos__ruta ON ${NODOS} (expediente_id, ruta text_pattern_ops);`,
  );
  await queryInterface.sequelize.query(
    `CREATE INDEX IF NOT EXISTS idx_nodos__papelera ON ${NODOS} (_tenant_id, borrado_en) WHERE borrado_en IS NOT NULL;`,
  );

  await queryInterface.sequelize.query(`
CREATE TABLE IF NOT EXISTS ${CONCESIONES} (
  _id               BIGSERIAL PRIMARY KEY,
  _tenant_id        BIGINT      NOT NULL REFERENCES ${TENANTS}(_id) ON UPDATE CASCADE ON DELETE RESTRICT,
  nodo_id           BIGINT      NOT NULL REFERENCES ${NODOS}(_id) ON UPDATE CASCADE ON DELETE CASCADE,
  -- A un ROL o a una PERSONA. El rol cubre «todos los analistas de fraude ven los expedientes en
  -- investigación»; la persona cubre «este auditor externo, este mes, esta carpeta».
  principal_tipo    VARCHAR(20) NOT NULL,
  principal_id      VARCHAR(64) NOT NULL,
  nivel             VARCHAR(20) NOT NULL,
  otorgado_por_id   BIGINT REFERENCES ${INTERNAL_USERS}(_id) ON UPDATE CASCADE ON DELETE SET NULL,
  -- Obligatorio para compartir y administrar: quien amplía el acceso a evidencia de una persona
  -- tiene que dejar dicho por qué, y eso se comprueba en el servicio, no aquí.
  motivo            TEXT,
  vence_en          TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  revocado_en       TIMESTAMPTZ,
  revocado_por_id   BIGINT REFERENCES ${INTERNAL_USERS}(_id) ON UPDATE CASCADE ON DELETE SET NULL,
  CONSTRAINT ck_concesiones__principal CHECK (principal_tipo IN ('rol', 'usuario_interno')),
  CONSTRAINT ck_concesiones__nivel CHECK (nivel IN ('leer', 'escribir', 'compartir', 'administrar'))
);`);

  await queryInterface.sequelize.query(
    `CREATE UNIQUE INDEX IF NOT EXISTS ux_concesiones__vigente
       ON ${CONCESIONES} (nodo_id, principal_tipo, principal_id)
       WHERE revocado_en IS NULL;`,
  );
  await queryInterface.sequelize.query(
    `CREATE INDEX IF NOT EXISTS idx_concesiones__principal ON ${CONCESIONES} (_tenant_id, principal_tipo, principal_id) WHERE revocado_en IS NULL;`,
  );

  await queryInterface.sequelize.query(`
CREATE TABLE IF NOT EXISTS ${ACTIVIDAD} (
  _id             BIGSERIAL PRIMARY KEY,
  _tenant_id      BIGINT      NOT NULL REFERENCES ${TENANTS}(_id) ON UPDATE CASCADE ON DELETE RESTRICT,
  expediente_id   BIGINT      NOT NULL REFERENCES ${EXPEDIENTES}(_id) ON UPDATE CASCADE ON DELETE CASCADE,
  nodo_id         BIGINT,
  accion          VARCHAR(30) NOT NULL,
  actor_tipo      VARCHAR(20) NOT NULL,
  actor_id        BIGINT,
  request_id      VARCHAR(64),
  ip              INET,
  -- Nunca bytes ni PII en claro: aquí va el «de» y el «a» de un renombrado, el motivo de un
  -- compartir, el hash de lo que se descargó. Quien audita necesita saber QUÉ pasó, no volver a
  -- ver el documento.
  detalle         JSONB       NOT NULL DEFAULT '{}'::jsonb,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);`);

  await queryInterface.sequelize.query(
    `CREATE INDEX IF NOT EXISTS idx_actividad__expediente ON ${ACTIVIDAD} (_tenant_id, expediente_id, created_at DESC);`,
  );
  await queryInterface.sequelize.query(
    `CREATE INDEX IF NOT EXISTS idx_actividad__nodo ON ${ACTIVIDAD} (_tenant_id, nodo_id, created_at DESC);`,
  );
  await queryInterface.sequelize.query(
    `CREATE INDEX IF NOT EXISTS idx_actividad__actor ON ${ACTIVIDAD} (_tenant_id, actor_id, created_at DESC);`,
  );

  /*
   * La actividad es SÓLO-AÑADIR, y lo sostiene la base.
   *
   * Es la misma guarda que protege el hilo de soporte (`create-support-append-only-guards`). Un
   * registro de quién vio el carnet de una persona que se puede editar desde la aplicación no
   * sirve para lo único que existe: responder «¿quién accedió a esto?» cuando alguien lo pregunta
   * en serio. El permiso de la base es el que lo garantiza, no la disciplina de quien programa.
   */
  await queryInterface.sequelize.query(`
CREATE OR REPLACE FUNCTION ${SCHEMA}.expediente_actividad_solo_anadir()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'expediente_actividad es sólo-añadir: % no está permitido', TG_OP;
END;
$$ LANGUAGE plpgsql;`);
  await queryInterface.sequelize.query(`DROP TRIGGER IF EXISTS trg_actividad_solo_anadir ON ${ACTIVIDAD};`);
  await queryInterface.sequelize.query(`
CREATE TRIGGER trg_actividad_solo_anadir
  BEFORE UPDATE OR DELETE ON ${ACTIVIDAD}
  FOR EACH ROW EXECUTE FUNCTION ${SCHEMA}.expediente_actividad_solo_anadir();`);

  await queryInterface.sequelize.query(`
CREATE TABLE IF NOT EXISTS ${TICKETS} (
  _id               BIGSERIAL PRIMARY KEY,
  _tenant_id        BIGINT      NOT NULL REFERENCES ${TENANTS}(_id) ON UPDATE CASCADE ON DELETE RESTRICT,
  expediente_id     BIGINT      NOT NULL REFERENCES ${EXPEDIENTES}(_id) ON UPDATE CASCADE ON DELETE CASCADE,
  parent_id         BIGINT      REFERENCES ${NODOS}(_id) ON UPDATE CASCADE ON DELETE CASCADE,
  nombre_previsto   VARCHAR(255) NOT NULL,
  mime_type         VARCHAR(100) NOT NULL,
  size_bytes        BIGINT      NOT NULL,
  sha256_declarado  CHAR(64),
  storage_key       TEXT        NOT NULL,
  emitido_por_id    BIGINT REFERENCES ${INTERNAL_USERS}(_id) ON UPDATE CASCADE ON DELETE SET NULL,
  vence_en          TIMESTAMPTZ NOT NULL,
  consumido_en      TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);`);

  // Los que la limpieza tiene que recoger: sin esto, cada subida que alguien abandona deja un
  // objeto en el bucket que ninguna fila referencia y que nadie va a encontrar nunca.
  await queryInterface.sequelize.query(
    `CREATE INDEX IF NOT EXISTS idx_tickets__pendientes ON ${TICKETS} (vence_en) WHERE consumido_en IS NULL;`,
  );

  // Se declara al final: el manifiesto es un nodo, y el nodo necesita que su tabla exista.
  await queryInterface.sequelize.query(`
ALTER TABLE ${EXPEDIENTES}
  ADD CONSTRAINT fk_expedientes__manifest
  FOREIGN KEY (manifest_nodo_id) REFERENCES ${NODOS}(_id) ON UPDATE CASCADE ON DELETE SET NULL;`);
}

export async function down({ context: queryInterface }: MigrationContext): Promise<void> {
  await queryInterface.sequelize.query(`ALTER TABLE IF EXISTS ${EXPEDIENTES} DROP CONSTRAINT IF EXISTS fk_expedientes__manifest;`);
  await queryInterface.sequelize.query(`DROP TRIGGER IF EXISTS trg_actividad_solo_anadir ON ${ACTIVIDAD};`);
  await queryInterface.sequelize.query(`DROP FUNCTION IF EXISTS ${SCHEMA}.expediente_actividad_solo_anadir();`);
  await queryInterface.sequelize.query(`DROP TABLE IF EXISTS ${TICKETS};`);
  await queryInterface.sequelize.query(`DROP TABLE IF EXISTS ${ACTIVIDAD};`);
  await queryInterface.sequelize.query(`DROP TABLE IF EXISTS ${CONCESIONES};`);
  await queryInterface.sequelize.query(`DROP TABLE IF EXISTS ${NODOS};`);
  await queryInterface.sequelize.query(`DROP TABLE IF EXISTS ${EXPEDIENTES};`);
}
