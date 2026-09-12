/**
 * @file Migración reversible: evoluciona el esquema PostgreSQL en orden.
 * @business Esta pieza evita que el aviso de «desactualizado» salte sobre todo y deje de leerse.
 * @system guarda la huella del código del que cuelga cada flujo, para decidir la frescura por flujo.
 */
import { QueryInterface } from 'sequelize';
import { atlasSchemaFor } from '../domain-schemas.js';

type MigrationContext = { context: QueryInterface };

const FLOWS = `${atlasSchemaFor('system_flow_catalog')}.system_flow_catalog`;

/**
 * Flujos, ola 12: la frescura deja de ser un aviso que salta sobre todo.
 *
 * `freshness` se decidía comparando el commit analizado con el desplegado, así que CUALQUIER commit
 * del repositorio marcaba STALE los mil flujos del bloque —incluidos los novecientos que nadie
 * tocó—. Un aviso que salta siempre no se lee, y con él se pierden los cinco que sí importaban.
 *
 * `deps_hash` es la huella del código del que cuelga ESE flujo: su controlador y todo lo que el
 * análisis siguió (services, repositories). La pregunta pasa a ser la correcta —«¿cambió el código
 * de este flujo desde que se verificó?»— y se contesta comparando la huella guardada con la que
 * trae la recarga, sin que este backend tenga que leer ningún repositorio.
 *
 * Nulo mientras no haya pasado una recarga con huella: significa «no consta», y por eso no se opina
 * sobre la frescura de un flujo sin ella en vez de suponerla fresca.
 */
export async function up({ context: queryInterface }: MigrationContext): Promise<void> {
  await queryInterface.sequelize.query(`
ALTER TABLE ${FLOWS}
  ADD COLUMN IF NOT EXISTS deps_hash VARCHAR(32);
`);
}

export async function down({ context: queryInterface }: MigrationContext): Promise<void> {
  await queryInterface.sequelize.query(`ALTER TABLE ${FLOWS} DROP COLUMN IF EXISTS deps_hash;`);
}
