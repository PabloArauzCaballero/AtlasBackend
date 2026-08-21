/**
 * @file Migración reversible: evoluciona el esquema PostgreSQL en orden.
 * @business Esta pieza preserva la fuente de verdad y la evidencia histórica que soportan decisiones y cumplimiento.
 * @system define migrations para evolucionar, mapear, sembrar o consultar PostgreSQL de forma controlada.
 */
import { QueryInterface } from 'sequelize';

type MigrationContext = { context: QueryInterface };

/**
 * El catálogo deja de ser el catálogo de UN backend y pasa a ser el del ECOSISTEMA.
 *
 * ## Qué estaba mal
 *
 * `system_data_entity_catalog` no tenía ninguna columna que dijera de qué producto era cada tabla,
 * porque no hacía falta: todas venían de introspeccionar la base de ESTE backend. El resultado es
 * que el portal interno enseñaba un «Catálogo de datos» que en realidad era «las tablas de Atlas
 * Backend», sin decirlo. Un operador que abría esa pantalla veía un ecosistema de un solo producto
 * y no tenía forma de notar que faltaban el motor de decisión y el ERP.
 *
 * En endpoints el hueco era más sutil: `backend_service` existe desde 20260713100000 y hasta se
 * puede filtrar por él, pero NADIE lo escribía nunca con un valor distinto de `atlas-backend`. Una
 * dimensión que sólo tiene un valor no es una dimensión: es una columna decorativa.
 *
 * ## Por qué `system_code` y no reutilizar `backend_service`
 *
 * Son dos cosas distintas y conviene que sigan siéndolo. `backend_service` es la identidad de
 * DESPLIEGUE («qué proceso sirve esta ruta»), y un mismo bloque puede servirse desde más de uno
 * (api y worker, hoy; réplicas con nombre propio, mañana). `system_code` es la identidad de
 * PRODUCTO, y es la que el portal agrupa y filtra. Fundirlas obligaría a elegir cuál de las dos
 * preguntas se puede contestar.
 *
 * ## Por qué cambia el índice único de entidades
 *
 * `ux_system_data_entity_catalog_schema_table` daba por hecho que `(esquema, tabla)` identifica una
 * entidad, lo cual es cierto dentro de UNA base y falso en cuanto hay tres. El motor de decisión
 * guarda todo en `public`, y el ERP tiene su propio `atlas_accounting`: sin el bloque en la clave,
 * la primera tabla federada que repitiera nombre con una de aquí SOBREESCRIBIRÍA a la de Atlas en
 * silencio, que es la peor forma posible de fallar — el catálogo seguiría teniendo una fila con ese
 * nombre y nadie vería que perdió la otra.
 */
export async function up({ context: queryInterface }: MigrationContext): Promise<void> {
  await queryInterface.sequelize.query(`
ALTER TABLE system_data_entity_catalog
  ADD COLUMN IF NOT EXISTS system_code VARCHAR(60) NOT NULL DEFAULT 'ATLAS_BACKEND';

ALTER TABLE system_endpoint_catalog
  ADD COLUMN IF NOT EXISTS system_code VARCHAR(60) NOT NULL DEFAULT 'ATLAS_BACKEND';

-- El respaldo del valor por omisión es exacto, no optimista: todo lo que hay catalogado hoy salió
-- de introspeccionar esta base y este router, así que TODO es ATLAS_BACKEND. Los endpoints se
-- alinean con lo que ya declaraba backend_service por si alguna instalación lo hubiera usado.
UPDATE system_endpoint_catalog
   SET system_code = CASE
     WHEN backend_service ILIKE '%decision%' THEN 'DECISION_ENGINE'
     WHEN backend_service ILIKE '%erp%' THEN 'ERP_BACKEND'
     ELSE 'ATLAS_BACKEND'
   END
 WHERE system_code = 'ATLAS_BACKEND';

CREATE INDEX IF NOT EXISTS ix_system_data_entity_catalog_system_code
  ON system_data_entity_catalog(system_code);
CREATE INDEX IF NOT EXISTS ix_system_endpoint_catalog_system_code
  ON system_endpoint_catalog(system_code);

DROP INDEX IF EXISTS ux_system_data_entity_catalog_schema_table;
CREATE UNIQUE INDEX IF NOT EXISTS ux_system_data_entity_catalog_block_schema_table
  ON system_data_entity_catalog(system_code, schema_name, table_name);

-- Y la misma corrección para endpoints, por la misma razón y con un ejemplo real: el ERP expone
-- GET /api/v1/health y este backend tambien. Con la clave antigua, catalogar el segundo borraba al
-- primero o rompia la federacion entera; ninguna de las dos cosas es aceptable, porque son dos
-- rutas distintas de dos productos distintos que casualmente se llaman igual.
DROP INDEX IF EXISTS ux_system_endpoint_catalog_method_full_path;
CREATE UNIQUE INDEX IF NOT EXISTS ux_system_endpoint_catalog_block_method_full_path
  ON system_endpoint_catalog(system_code, method, full_path);

-- Estado de la federación, una fila por bloque. CALIFICADA con su esquema a propósito: el
-- search_path de las migraciones lleva public DELANTE (ATLAS_MIGRATION_SEARCH_PATH), asi que una
-- tabla nueva sin calificar aterriza en public mientras el modelo la busca en platform_ops. Las
-- sentencias de arriba no lo necesitan porque ALTER resuelve sobre una tabla que ya existe.
--
-- Existe para que «no veo tablas del ERP» tenga SIEMPRE una respuesta, y la respuesta correcta:
-- nunca se intentó, se intentó y falló con este motivo, o se logró en este instante y trajo esta
-- cantidad. Sin esta tabla los tres casos se ven igual —una lista vacía— y el operador acaba
-- adivinando si el problema es del ERP, de la red o de la configuración.
CREATE TABLE IF NOT EXISTS platform_ops.system_block_federation_state (
  _id BIGSERIAL PRIMARY KEY,
  system_code VARCHAR(60) NOT NULL UNIQUE,
  last_attempt_at TIMESTAMPTZ,
  last_success_at TIMESTAMPTZ,
  last_status VARCHAR(40) NOT NULL DEFAULT 'NEVER_RUN',
  last_message TEXT,
  endpoints_imported INTEGER NOT NULL DEFAULT 0,
  data_entities_imported INTEGER NOT NULL DEFAULT 0,
  remote_version VARCHAR(60),
  remote_commit VARCHAR(80),
  _created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  _updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT ck_system_block_federation_state_status
    CHECK (last_status IN ('NEVER_RUN', 'NOT_CONFIGURED', 'OK', 'UNREACHABLE', 'UNAUTHORIZED', 'INVALID_MANIFEST', 'ERROR'))
);
`);
}

export async function down({ context: queryInterface }: MigrationContext): Promise<void> {
  await queryInterface.sequelize.query(`
DROP TABLE IF EXISTS platform_ops.system_block_federation_state;

DROP INDEX IF EXISTS ux_system_data_entity_catalog_block_schema_table;
-- Sólo se puede volver a la clave antigua si no quedan colisiones; borrar lo federado es lo que
-- las quita, y es lo correcto: era exactamente lo que esta migración vino a permitir guardar.
DELETE FROM system_data_entity_catalog WHERE system_code <> 'ATLAS_BACKEND';
DELETE FROM system_endpoint_catalog WHERE system_code <> 'ATLAS_BACKEND';
CREATE UNIQUE INDEX IF NOT EXISTS ux_system_data_entity_catalog_schema_table
  ON system_data_entity_catalog(schema_name, table_name);

DROP INDEX IF EXISTS ux_system_endpoint_catalog_block_method_full_path;
CREATE UNIQUE INDEX IF NOT EXISTS ux_system_endpoint_catalog_method_full_path
  ON system_endpoint_catalog(method, full_path);

DROP INDEX IF EXISTS ix_system_endpoint_catalog_system_code;
DROP INDEX IF EXISTS ix_system_data_entity_catalog_system_code;

ALTER TABLE system_endpoint_catalog DROP COLUMN IF EXISTS system_code;
ALTER TABLE system_data_entity_catalog DROP COLUMN IF EXISTS system_code;
`);
}
