/**
 * @file Migración reversible: evoluciona el esquema PostgreSQL en orden.
 * @business Esta pieza preserva la fuente de verdad y la evidencia histórica que soportan decisiones y cumplimiento.
 * @system define migrations para evolucionar, mapear, sembrar o consultar PostgreSQL de forma controlada.
 */
import { QueryInterface } from 'sequelize';
import { atlasSchemaFor } from '../domain-schemas.js';

type MigrationContext = { context: QueryInterface };

const FLOWS = `${atlasSchemaFor('system_flow_catalog')}.system_flow_catalog`;

/**
 * Flujos, fase 2: el análisis estático del handler hacia el service y la tabla.
 *
 * `analysis_json` guarda lo que `flows:analyze` resolvió con el verificador de tipos (cadena de
 * services, SQL crudo, excepciones, salidas HTTP, huecos con motivo). `reads` y `writes` se
 * desnormalizan como JSONB aparte porque son lo que se filtra y lo que decide el riesgo: buscar
 * «qué flujos escriben `loans`» no debería recorrer el JSON entero. Con esto `risk_basis` puede
 * pasar de `module-heuristic` a `tables-written`, que es la medida que el plan (§7) pedía.
 */
export async function up({ context: queryInterface }: MigrationContext): Promise<void> {
  await queryInterface.sequelize.query(`
ALTER TABLE ${FLOWS}
  ADD COLUMN IF NOT EXISTS analysis_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS reads         JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS writes        JSONB NOT NULL DEFAULT '[]'::jsonb;
CREATE INDEX IF NOT EXISTS ix_system_flow_catalog_writes ON ${FLOWS} USING GIN (writes);
CREATE INDEX IF NOT EXISTS ix_system_flow_catalog_reads ON ${FLOWS} USING GIN (reads);
`);
}

export async function down({ context: queryInterface }: MigrationContext): Promise<void> {
  await queryInterface.sequelize.query(`
DROP INDEX IF EXISTS ${atlasSchemaFor('system_flow_catalog')}.ix_system_flow_catalog_writes;
DROP INDEX IF EXISTS ${atlasSchemaFor('system_flow_catalog')}.ix_system_flow_catalog_reads;
ALTER TABLE ${FLOWS}
  DROP COLUMN IF EXISTS analysis_json,
  DROP COLUMN IF EXISTS reads,
  DROP COLUMN IF EXISTS writes;
`);
}
