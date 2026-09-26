/**
 * @file Migración reversible: evoluciona el esquema PostgreSQL en orden.
 * @business Esta pieza preserva la fuente de verdad y la evidencia histórica que soportan decisiones y cumplimiento.
 * @system define migrations para evolucionar, mapear, sembrar o consultar PostgreSQL de forma controlada.
 */
import { QueryInterface } from 'sequelize';
import { atlasSchemaFor } from '../domain-schemas.js';

type MigrationContext = { context: QueryInterface };

const FLOWS = `${atlasSchemaFor('system_flow_catalog')}.system_flow_catalog`;
const SCREENS = `${atlasSchemaFor('system_screen_catalog')}.system_screen_catalog`;
const FINDINGS = `${atlasSchemaFor('system_flow_findings')}.system_flow_findings`;
const IMPORTS = `${atlasSchemaFor('system_flow_imports')}.system_flow_imports`;

/**
 * Flujos (Flow Intelligence), fase 1: el catálogo derivado del código.
 *
 * ## Qué guarda y qué no
 *
 * Estas cuatro tablas son una CACHÉ consultable del artefacto que produce `flows:derive`
 * (`_plan-flow-intelligence-2026-09-09/tools/derive.mjs`): se pueden vaciar y recargar desde
 * el JSON sin perder nada, porque la fuente de verdad es el código en el commit analizado. Por
 * eso no llevan `_deleted`: una fila que ya no viene en el artefacto se borra, no se archiva.
 *
 * `system_flow_catalog` es una fila por operación HTTP de cada bloque (nivel 2 del plan): con qué
 * roles y permisos se protege, quién la llama (clientes y bloques), si la nombra algún test, si
 * está en el contrato, y el riesgo calculado. Los nodos y aristas del grafo (fase 2) vendrán en
 * tablas aparte; aquí no se anticipa su forma.
 *
 * ## Por qué `flow_id` no es el `_id`
 *
 * El `_id` es de esta base; el `flow_id` (`flow_` + hash de bloque+método+ruta) es el que ven los
 * enlaces profundos del portal y los bugs, y tiene que sobrevivir a una recarga desde cero y a la
 * federación con los otros bloques. Un secuencial `FLOW-0042` cambiaría en cada regeneración.
 *
 * ## Por qué no cuelga de `system_endpoint_catalog`
 *
 * Ese catálogo se alimenta por descubrimiento y por revisión humana, y no siempre tiene la ruta
 * que el código declara (el modo `SOURCE_SCAN` devuelve 0 en contenedor). Flujos parte del código
 * y guarda su propia clave `(system_code, http_method, path)`; el cruce con el catálogo se hace
 * por esa clave al consultar, no por FK, para que un catálogo incompleto no oculte flujos.
 */
export async function up({ context: queryInterface }: MigrationContext): Promise<void> {
  await queryInterface.sequelize.query(`
CREATE TABLE IF NOT EXISTS ${IMPORTS} (
  _id               BIGSERIAL PRIMARY KEY,
  scope             VARCHAR(20)  NOT NULL,
  system_code       VARCHAR(60)  NOT NULL,
  analyzed_commit   VARCHAR(64),
  analyzed_branch   VARCHAR(80),
  content_hash      VARCHAR(64),
  rows_received     INTEGER      NOT NULL DEFAULT 0,
  rows_upserted     INTEGER      NOT NULL DEFAULT 0,
  rows_removed      INTEGER      NOT NULL DEFAULT 0,
  created_by        VARCHAR(80),
  _created_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS ix_system_flow_imports_scope ON ${IMPORTS} (scope, system_code, _created_at DESC);

CREATE TABLE IF NOT EXISTS ${FLOWS} (
  _id                  BIGSERIAL PRIMARY KEY,
  flow_id              VARCHAR(40)  NOT NULL UNIQUE,
  slug                 VARCHAR(220) NOT NULL,
  system_code          VARCHAR(60)  NOT NULL,
  name                 VARCHAR(220) NOT NULL,
  module               VARCHAR(120) NOT NULL,
  kind                 VARCHAR(20)  NOT NULL,
  risk                 VARCHAR(12)  NOT NULL,
  risk_basis           VARCHAR(40)  NOT NULL DEFAULT 'module-heuristic',
  badges               JSONB        NOT NULL DEFAULT '[]'::jsonb,
  discovery            VARCHAR(20)  NOT NULL DEFAULT 'DISCOVERED',
  verification         VARCHAR(20)  NOT NULL DEFAULT 'UNVERIFIED',
  freshness            VARCHAR(12)  NOT NULL DEFAULT 'FRESH',
  http_method          VARCHAR(10)  NOT NULL,
  path                 VARCHAR(400) NOT NULL,
  controller           VARCHAR(160) NOT NULL,
  handler              VARCHAR(160) NOT NULL,
  source_file          VARCHAR(300),
  source_line          INTEGER,
  is_public            BOOLEAN      NOT NULL DEFAULT false,
  roles                JSONB        NOT NULL DEFAULT '[]'::jsonb,
  internal_permissions JSONB        NOT NULL DEFAULT '[]'::jsonb,
  guards               JSONB        NOT NULL DEFAULT '[]'::jsonb,
  callers              JSONB        NOT NULL DEFAULT '[]'::jsonb,
  test_status          VARCHAR(12)  NOT NULL DEFAULT 'UNTESTED',
  contract_status      VARCHAR(16)  NOT NULL DEFAULT 'NO_CONTRACT',
  findings_count       INTEGER      NOT NULL DEFAULT 0,
  analyzed_commit      VARCHAR(64),
  analyzed_branch      VARCHAR(80),
  import_id            BIGINT       REFERENCES ${IMPORTS}(_id) ON DELETE SET NULL,
  _created_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  _updated_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_system_flow_catalog_route ON ${FLOWS} (system_code, http_method, path);
CREATE INDEX IF NOT EXISTS ix_system_flow_catalog_filters ON ${FLOWS} (system_code, module, risk, kind);
CREATE INDEX IF NOT EXISTS ix_system_flow_catalog_state ON ${FLOWS} (verification, discovery, freshness);

CREATE TABLE IF NOT EXISTS ${SCREENS} (
  _id               BIGSERIAL PRIMARY KEY,
  client_code       VARCHAR(40)  NOT NULL,
  route             VARCHAR(300) NOT NULL,
  source_file       VARCHAR(300),
  nav_label         VARCHAR(160),
  nav_permissions   JSONB        NOT NULL DEFAULT '[]'::jsonb,
  nav_roles         JSONB        NOT NULL DEFAULT '[]'::jsonb,
  analyzed_commit   VARCHAR(64),
  import_id         BIGINT       REFERENCES ${IMPORTS}(_id) ON DELETE SET NULL,
  _created_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  _updated_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_system_screen_catalog_route ON ${SCREENS} (client_code, route);

CREATE TABLE IF NOT EXISTS ${FINDINGS} (
  _id               BIGSERIAL PRIMARY KEY,
  finding_key       VARCHAR(64)  NOT NULL UNIQUE,
  kind              VARCHAR(40)  NOT NULL,
  severity          VARCHAR(12)  NOT NULL,
  system_code       VARCHAR(60)  NOT NULL,
  ref               VARCHAR(400) NOT NULL,
  module            VARCHAR(120),
  summary           TEXT         NOT NULL,
  extra_json        JSONB        NOT NULL DEFAULT '{}'::jsonb,
  known_since       VARCHAR(300),
  status            VARCHAR(20)  NOT NULL DEFAULT 'open',
  import_id         BIGINT       REFERENCES ${IMPORTS}(_id) ON DELETE SET NULL,
  _created_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  _updated_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS ix_system_flow_findings_filters ON ${FINDINGS} (system_code, kind, severity, status);
`);

  await queryInterface.sequelize.query(`
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_system_flow_catalog_risk') THEN
    ALTER TABLE ${FLOWS} ADD CONSTRAINT ck_system_flow_catalog_risk
      CHECK (risk IN ('LOW','MEDIUM','HIGH','CRITICAL'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_system_flow_catalog_kind') THEN
    ALTER TABLE ${FLOWS} ADD CONSTRAINT ck_system_flow_catalog_kind
      CHECK (kind IN ('READ','CREATE','UPDATE','DELETE','ACTION','NAVIGATION','CLIENT_ONLY','CROSS_BLOCK'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_system_flow_catalog_state') THEN
    ALTER TABLE ${FLOWS} ADD CONSTRAINT ck_system_flow_catalog_state
      CHECK (discovery IN ('DISCOVERED','PARTIAL','MAPPED')
         AND verification IN ('UNVERIFIED','VERIFIED','BROKEN')
         AND freshness IN ('FRESH','STALE'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_system_flow_findings_severity') THEN
    ALTER TABLE ${FINDINGS} ADD CONSTRAINT ck_system_flow_findings_severity
      CHECK (severity IN ('LOW','MEDIUM','HIGH','CRITICAL') AND status IN ('open','acknowledged','resolved','false_positive'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_system_flow_imports_scope') THEN
    ALTER TABLE ${IMPORTS} ADD CONSTRAINT ck_system_flow_imports_scope
      CHECK (scope IN ('endpoints','screens','findings'));
  END IF;
END $$;
`);
}

export async function down({ context: queryInterface }: MigrationContext): Promise<void> {
  await queryInterface.sequelize.query(`
DROP TABLE IF EXISTS ${FINDINGS};
DROP TABLE IF EXISTS ${SCREENS};
DROP TABLE IF EXISTS ${FLOWS};
DROP TABLE IF EXISTS ${IMPORTS};
`);
}
