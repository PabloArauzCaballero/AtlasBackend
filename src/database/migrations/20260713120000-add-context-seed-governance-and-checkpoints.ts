import { QueryInterface } from 'sequelize';

type MigrationContext = { context: QueryInterface };

/**
 * Persiste los controles de uso incluidos en el paquete multidominio y permite
 * reanudar su importacion por chunks sin volver a insertar filas ya confirmadas.
 * Todos los DDL son idempotentes para soportar recuperacion tras una ejecucion
 * interrumpida.
 */
export async function up({ context: queryInterface }: MigrationContext): Promise<void> {
  await queryInterface.sequelize.query(`
ALTER TABLE public.context_risk_mappings
  ADD COLUMN IF NOT EXISTS allowed_for_direct_adverse_credit_action BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS requires_calibration BOOLEAN NOT NULL DEFAULT TRUE;

CREATE TABLE IF NOT EXISTS public.context_seed_import_checkpoints (
  _id BIGSERIAL PRIMARY KEY,
  package_build_version VARCHAR(100) NOT NULL,
  catalog_code VARCHAR(80) NOT NULL,
  relative_path VARCHAR(300) NOT NULL,
  item_count INTEGER NOT NULL CHECK (item_count > 0),
  content_sha256 CHAR(64) NOT NULL,
  completed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT ux_context_seed_import_checkpoint
    UNIQUE (catalog_code, relative_path, item_count)
);

CREATE INDEX IF NOT EXISTS ix_context_seed_import_checkpoints_build
  ON public.context_seed_import_checkpoints (package_build_version, completed_at DESC);
`);
}

export async function down({ context: queryInterface }: MigrationContext): Promise<void> {
  await queryInterface.sequelize.query(`
DROP INDEX IF EXISTS public.ix_context_seed_import_checkpoints_build;
DROP TABLE IF EXISTS public.context_seed_import_checkpoints;

ALTER TABLE public.context_risk_mappings
  DROP COLUMN IF EXISTS requires_calibration,
  DROP COLUMN IF EXISTS allowed_for_direct_adverse_credit_action;
`);
}
