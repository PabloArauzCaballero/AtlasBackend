/**
 * @file Migración reversible: evoluciona el esquema PostgreSQL en orden.
 * @business Esta pieza permite documentar TODOS los procesos de Atlas —también los que cruzan al Motor y al ERP, los jobs y los eventos— y medir si cada paso de una persona tiene pantalla.
 * @system amplía `workflow_definitions`, `workflow_stages` y `workflow_steps` y crea `workflow_definitions_sync`, la huella de qué versión del código tiene la base.
 */
import { QueryInterface } from 'sequelize';
import { atlasSchemaFor } from '../domain-schemas.js';

type MigrationContext = { context: QueryInterface };

const DEFINITIONS = `${atlasSchemaFor('workflow_definitions')}.workflow_definitions`;
const STAGES = `${atlasSchemaFor('workflow_stages')}.workflow_stages`;
const STEPS = `${atlasSchemaFor('workflow_steps')}.workflow_steps`;
const SYNC = `${atlasSchemaFor('workflow_definitions_sync')}.workflow_definitions_sync`;

const SYSTEMS = `'ATLAS_BACKEND','DECISION_ENGINE','ERP_BACKEND','DASHBOARDS','AI_SERVICE','EXTERNAL_PROVIDERS_MOCK'`;
const CLIENTS = `'ADMIN_PORTAL','ERP_PORTAL','MOTOR_PORTAL','CONSUMER_APP','DASHBOARDS_PORTAL','BLOCK'`;

/**
 * Por qué hace falta (plan «documentar todos los procesos», 2026-09-26, §4.1).
 *
 * El catálogo sólo sabía describir recorridos del cliente hechos de llamadas HTTP a este Backend.
 * Treinta y cinco de los treinta y ocho procesos de Atlas no caben ahí: el alta del comercio cruza
 * ERP → Motor → Portal, la contabilidad vive entera en el ERP, la mora es un job y la cobertura es un
 * evento del outbox. Tampoco decía QUIÉN es dueño, qué pasa si falla ni DESDE QUÉ PANTALLA actúa la
 * persona, que es justo lo que hace falta para medir el cableado.
 *
 * - Definición: narrativa (cinco preguntas), dueño, prioridad, id del inventario (`P-nn`), entidad de
 *   instancia y bloques que atraviesa. `source` admite `code`: el catálogo ya no sale de la siembra.
 * - Etapa: cliente desde el que se actúa, ruta de la pantalla y enlace con contexto a otro portal.
 * - Paso: bloque que lo sirve, naturaleza (`http`, `event`, `job`, `manual`, `external`) y job. Método
 *   y ruta dejan de ser obligatorios SÓLO para los pasos que no son HTTP: el CHECK lo sigue exigiendo
 *   para los que sí.
 * - `workflow_definitions_sync`: una fila por proceso con la huella del contenido volcado. Es lo que
 *   dice si la base desplegada tiene la versión del código (la lección del 15-09 con los permisos).
 *
 * Los CHECK se amplían ANTES de que ninguna migración escriba los valores nuevos.
 */
export async function up({ context: queryInterface }: MigrationContext): Promise<void> {
  const q = (sql: string) => queryInterface.sequelize.query(sql);

  await q(`
ALTER TABLE ${DEFINITIONS}
  ADD COLUMN IF NOT EXISTS narrative_json        JSONB       NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS owner_role            VARCHAR(80),
  ADD COLUMN IF NOT EXISTS priority              VARCHAR(4),
  ADD COLUMN IF NOT EXISTS process_id            VARCHAR(8),
  ADD COLUMN IF NOT EXISTS instance_entity_json  JSONB       NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS system_codes_json     JSONB       NOT NULL DEFAULT '[]'::jsonb;`);
  await q(`ALTER TABLE ${DEFINITIONS} DROP CONSTRAINT IF EXISTS ck_workflow_definitions_source;`);
  await q(
    `ALTER TABLE ${DEFINITIONS} ADD CONSTRAINT ck_workflow_definitions_source CHECK (source IN ('seed','manual','discovery','code'));`,
  );
  await q(`ALTER TABLE ${DEFINITIONS} DROP CONSTRAINT IF EXISTS ck_workflow_definitions_priority;`);
  await q(
    `ALTER TABLE ${DEFINITIONS} ADD CONSTRAINT ck_workflow_definitions_priority CHECK (priority IS NULL OR priority IN ('P0','P1','P2'));`,
  );

  await q(`
ALTER TABLE ${STAGES}
  ADD COLUMN IF NOT EXISTS client_code             VARCHAR(40),
  ADD COLUMN IF NOT EXISTS screen_route            TEXT,
  ADD COLUMN IF NOT EXISTS external_link_template  TEXT;`);
  await q(`ALTER TABLE ${STAGES} DROP CONSTRAINT IF EXISTS ck_workflow_stages_client_code;`);
  await q(
    `ALTER TABLE ${STAGES} ADD CONSTRAINT ck_workflow_stages_client_code CHECK (client_code IS NULL OR client_code IN (${CLIENTS}));`,
  );

  await q(`
ALTER TABLE ${STEPS}
  ADD COLUMN IF NOT EXISTS system_code  VARCHAR(40)  NOT NULL DEFAULT 'ATLAS_BACKEND',
  ADD COLUMN IF NOT EXISTS step_kind    VARCHAR(20)  NOT NULL DEFAULT 'http',
  ADD COLUMN IF NOT EXISTS job_code     VARCHAR(120);`);
  await q(`ALTER TABLE ${STEPS} DROP CONSTRAINT IF EXISTS ck_workflow_steps_system_code;`);
  await q(`ALTER TABLE ${STEPS} ADD CONSTRAINT ck_workflow_steps_system_code CHECK (system_code IN (${SYSTEMS}));`);
  await q(`ALTER TABLE ${STEPS} DROP CONSTRAINT IF EXISTS ck_workflow_steps_step_kind;`);
  await q(
    `ALTER TABLE ${STEPS} ADD CONSTRAINT ck_workflow_steps_step_kind CHECK (step_kind IN ('http','event','job','manual','external'));`,
  );
  await q(`ALTER TABLE ${STEPS} ALTER COLUMN http_method DROP NOT NULL, ALTER COLUMN route_path DROP NOT NULL;`);
  await q(`ALTER TABLE ${STEPS} DROP CONSTRAINT IF EXISTS ck_workflow_steps_http_method;`);
  await q(
    `ALTER TABLE ${STEPS} ADD CONSTRAINT ck_workflow_steps_http_method CHECK (http_method IS NULL OR http_method IN ('GET','POST','PUT','PATCH','DELETE','HEAD','OPTIONS'));`,
  );
  await q(`ALTER TABLE ${STEPS} DROP CONSTRAINT IF EXISTS ck_workflow_steps_route_path;`);
  await q(
    `ALTER TABLE ${STEPS} ADD CONSTRAINT ck_workflow_steps_route_path CHECK (step_kind <> 'http' OR (route_path LIKE '/%' AND http_method IS NOT NULL));`,
  );

  await q(`
CREATE TABLE IF NOT EXISTS ${SYNC} (
  workflow_code  VARCHAR(80)  PRIMARY KEY,
  version        VARCHAR(20)  NOT NULL,
  content_hash   VARCHAR(64)  NOT NULL,
  applied_by     VARCHAR(160) NOT NULL,
  applied_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);`);
  await q(`CREATE INDEX IF NOT EXISTS ix_workflow_definitions_priority ON ${DEFINITIONS} (priority, process_type) WHERE _deleted = false;`);
}

/**
 * Deshace el esquema. Falla —con razón— si ya hay pasos que no son HTTP: devolverle el NOT NULL a
 * `route_path` sin retirar esas filas dejaría la tabla en un estado que la propia restricción prohíbe.
 */
export async function down({ context: queryInterface }: MigrationContext): Promise<void> {
  const q = (sql: string) => queryInterface.sequelize.query(sql);
  await q(`DROP TABLE IF EXISTS ${SYNC};`);
  await q(`DROP INDEX IF EXISTS ${atlasSchemaFor('workflow_definitions')}.ix_workflow_definitions_priority;`);

  await q(`ALTER TABLE ${STEPS} DROP CONSTRAINT IF EXISTS ck_workflow_steps_route_path;`);
  await q(`ALTER TABLE ${STEPS} DROP CONSTRAINT IF EXISTS ck_workflow_steps_http_method;`);
  await q(`ALTER TABLE ${STEPS} ALTER COLUMN http_method SET NOT NULL, ALTER COLUMN route_path SET NOT NULL;`);
  await q(
    `ALTER TABLE ${STEPS} ADD CONSTRAINT ck_workflow_steps_http_method CHECK (http_method IN ('GET','POST','PUT','PATCH','DELETE','HEAD','OPTIONS'));`,
  );
  await q(`ALTER TABLE ${STEPS} ADD CONSTRAINT ck_workflow_steps_route_path CHECK (route_path LIKE '/%');`);
  await q(`ALTER TABLE ${STEPS} DROP CONSTRAINT IF EXISTS ck_workflow_steps_step_kind;`);
  await q(`ALTER TABLE ${STEPS} DROP CONSTRAINT IF EXISTS ck_workflow_steps_system_code;`);
  await q(`ALTER TABLE ${STEPS} DROP COLUMN IF EXISTS job_code, DROP COLUMN IF EXISTS step_kind, DROP COLUMN IF EXISTS system_code;`);

  await q(`ALTER TABLE ${STAGES} DROP CONSTRAINT IF EXISTS ck_workflow_stages_client_code;`);
  await q(
    `ALTER TABLE ${STAGES} DROP COLUMN IF EXISTS external_link_template, DROP COLUMN IF EXISTS screen_route, DROP COLUMN IF EXISTS client_code;`,
  );

  await q(`ALTER TABLE ${DEFINITIONS} DROP CONSTRAINT IF EXISTS ck_workflow_definitions_priority;`);
  await q(`ALTER TABLE ${DEFINITIONS} DROP CONSTRAINT IF EXISTS ck_workflow_definitions_source;`);
  // Lo volcado desde el código vuelve a contar como sembrado: es lo más parecido que admite el esquema anterior.
  await q(`UPDATE ${DEFINITIONS} SET source = 'seed' WHERE source = 'code';`);
  await q(`ALTER TABLE ${DEFINITIONS} ADD CONSTRAINT ck_workflow_definitions_source CHECK (source IN ('seed','manual','discovery'));`);
  await q(`
ALTER TABLE ${DEFINITIONS}
  DROP COLUMN IF EXISTS system_codes_json, DROP COLUMN IF EXISTS instance_entity_json, DROP COLUMN IF EXISTS process_id,
  DROP COLUMN IF EXISTS priority, DROP COLUMN IF EXISTS owner_role, DROP COLUMN IF EXISTS narrative_json;`);
}
