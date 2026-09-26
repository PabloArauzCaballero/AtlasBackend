/**
 * @file Migración reversible: evoluciona el esquema PostgreSQL en orden.
 * @business Convierte la asignación en un CATÁLOGO de decisiones: qué la llama y en qué flujo vive.
 * @system añade versión fijada, endpoints consumidores y flujo de trabajo a la asignación.
 */
import { QueryInterface } from 'sequelize';
import { atlasSchemaFor } from '../domain-schemas.js';

type MigrationContext = { context: QueryInterface };

const TABLE = `${atlasSchemaFor('decision_artifact_bindings')}.decision_artifact_bindings`;

/**
 * Saber QUÉ artefacto decide no basta: hay que saber quién lo llama y dónde encaja.
 *
 * La primera versión de esta tabla respondía «qué política decide una identidad». Faltaban las tres
 * preguntas que vienen justo después y que hoy sólo se pueden contestar leyendo el código:
 *
 * - **`pinned_version`** — qué VERSIÓN se ejecuta. Sin esto, publicar una versión nueva en el motor
 *   cambia lo que decide en producción sin que nadie lo apruebe: el despliegue activo manda. Fijarla
 *   convierte «actualizamos la política» en una decisión, no en un efecto secundario. Nulo significa
 *   «la vigente», que es el comportamiento de siempre y sigue siendo válido.
 *
 * - **`consumer_endpoints`** — qué endpoints del backend disparan esta decisión. Es lo que permite
 *   contestar «si cambio esta política, ¿qué se rompe?» sin abrir el editor. Hoy la respuesta vive
 *   repartida en cuatro servicios y sólo la conoce quien los ha leído.
 *
 * - **`workflow_stage`** — en qué punto del recorrido del cliente ocurre. Una política de identidad
 *   que se ejecuta en el alta y otra que se ejecuta en una renovación no son la misma decisión
 *   aunque compartan artefacto, y hasta ahora nada lo distinguía.
 *
 * Todo es opcional: una asignación existente sigue siendo válida sin ninguno de los tres.
 */
export async function up({ context: queryInterface }: MigrationContext): Promise<void> {
  await queryInterface.sequelize.query(`
ALTER TABLE ${TABLE}
  ADD COLUMN IF NOT EXISTS pinned_version     VARCHAR(40),
  ADD COLUMN IF NOT EXISTS consumer_endpoints TEXT,
  ADD COLUMN IF NOT EXISTS workflow_stage     VARCHAR(80),
  ADD COLUMN IF NOT EXISTS description        VARCHAR(500);`);
}

export async function down({ context: queryInterface }: MigrationContext): Promise<void> {
  await queryInterface.sequelize.query(`
ALTER TABLE ${TABLE}
  DROP COLUMN IF EXISTS pinned_version,
  DROP COLUMN IF EXISTS consumer_endpoints,
  DROP COLUMN IF EXISTS workflow_stage,
  DROP COLUMN IF EXISTS description;`);
}
