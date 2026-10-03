/**
 * @file Migración reversible: evoluciona el esquema PostgreSQL en orden.
 * @business La ayuda de la app volvía vacía: las preguntas frecuentes no aparecían hasta que alguien escribía algo.
 * @system rellena `knowledge_articles.current_version_id` con la última versión PUBLICADA donde estaba en NULL.
 */
import { QueryInterface } from 'sequelize';
import { atlasSchemaFor } from '../domain-schemas.js';

type MigrationContext = { context: QueryInterface };

const SCHEMA = atlasSchemaFor('knowledge_articles');
const ARTICLES = `${SCHEMA}.knowledge_articles`;
const VERSIONS = `${SCHEMA}.knowledge_article_versions`;

/**
 * `featuredFaq` y la búsqueda sólo ven un artículo si su `current_version_id` apunta a su versión
 * publicada (`support-knowledge.repository.ts`). La semilla de demostración creaba artículos y versiones
 * pero NUNCA enlazaba la una con la otra, así que en TEST el endpoint de FAQ devolvía `faq: []` y la
 * pantalla de Soporte parecía vacía. Aquí se enlaza lo que ya estaba sin enlazar: sólo filas publicadas,
 * sólo donde falta el enlace, y con la versión de mayor número. No toca un enlace ya puesto.
 */
export async function up({ context: queryInterface }: MigrationContext): Promise<void> {
  await queryInterface.sequelize.query(`
UPDATE ${ARTICLES} a
   SET current_version_id = v._id,
       _updated_at = NOW()
  FROM (
    SELECT DISTINCT ON (article_id) article_id, _id
      FROM ${VERSIONS}
     WHERE status = 'PUBLISHED'
     ORDER BY article_id, version_number DESC
  ) v
 WHERE a._id = v.article_id
   AND a.status = 'PUBLISHED'
   AND a.current_version_id IS NULL
   AND a._deleted IS DISTINCT FROM true;`);
}

/**
 * No hay `down` que valga: no se puede saber qué enlaces puso esta migración y cuáles puso el flujo de
 * publicación. Quitarlos todos rompería artículos publicados de verdad, así que deshacer es no hacer nada.
 */
export async function down(): Promise<void> {
  // Intencionadamente vacío.
}
