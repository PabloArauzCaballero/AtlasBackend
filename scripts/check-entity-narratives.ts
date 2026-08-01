/**
 * Gate estático: toda tabla con modelo ORM debe tener narrativa de gobierno curada.
 *
 * `system_data_entity_catalog` se puebla automáticamente desde `information_schema`, así que una
 * tabla nueva aparece en el catálogo con descripción genérica y NADIE se entera de que le falta la
 * parte que ningún proceso puede inferir: por qué existe para el negocio, por qué no se borra, qué
 * decide, un ejemplo real y cómo funciona por dentro. Un catálogo a medio documentar se ve igual
 * que uno completo, y esa es exactamente la falla que este gate hace ruidosa.
 *
 * Es estático a propósito (parsea los `@Table` como `check:domain-schemas`, no consulta la base):
 * corre en CI sin Postgres y falla en el PR que agrega la tabla, no semanas después al reseedear.
 *
 * Ejecutar con `yarn check:entity-narratives`.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ENTITY_BUSINESS_NARRATIVES, type EntityBusinessNarrative } from '../src/modules/systems-ops/entity-narratives/index.js';

const MODELS_DIR = resolve(process.cwd(), 'src/database/models');
const TABLE_DECORATOR = /@Table\(\{\s*tableName:\s*'([^']+)'/;

/**
 * Objetos reales del modelo que no tienen modelo ORM y por eso no aparecen al escanear `@Table`:
 * una vista de lectura y tablas que crean migraciones o el loader de contexto. Se listan a mano
 * para que un `tableName` mal escrito en una narrativa falle en vez de pasar como "objeto sin ORM".
 */
const NON_ORM_OBJECTS = new Set([
  'audit_event_feed',
  'catalog_entries',
  'context_seed_import_checkpoints',
  'schema_change_log',
  'schema_columns',
  'schema_relationships',
  'schema_tables',
  'schema_versions',
]);

/**
 * Piso de longitud por campo. No busca prosa bonita: descarta el relleno ("N/A", "tabla de
 * clientes") que convierte al catálogo en un formulario cumplido sin información.
 *
 * 80 deja margen deliberado sobre la narrativa real (medida sobre los 695 campos curados: mínimo
 * 131, mediana 247), así que no puede dispararse por un texto legítimamente conciso — solo atrapa
 * stubs. Subirlo para "forzar calidad" solo lograría que alguien rellene con palabras.
 */
const MIN_FIELD_LENGTH = 80;

const NARRATIVE_FIELDS = [
  'whyExists',
  'whyNotDelete',
  'decisionContribution',
  'usageExample',
  'systemsExplanation',
] as const satisfies readonly (keyof EntityBusinessNarrative)[];

function ormTables(): Map<string, string> {
  const tables = new Map<string, string>();
  for (const file of readdirSync(MODELS_DIR).filter((entry) => entry.endsWith('.model.ts'))) {
    const table = readFileSync(resolve(MODELS_DIR, file), 'utf8').match(TABLE_DECORATOR)?.[1];
    if (table) tables.set(table, file);
  }
  return tables;
}

function main(): void {
  const errors: string[] = [];
  const models = ormTables();
  const documented = new Set(ENTITY_BUSINESS_NARRATIVES.map((narrative) => narrative.tableName));

  for (const [table, file] of models) {
    if (!documented.has(table)) {
      errors.push(`${table} (${file}) no tiene narrativa. Agrégala en src/modules/systems-ops/entity-narratives/.`);
    }
  }

  for (const narrative of ENTITY_BUSINESS_NARRATIVES) {
    if (!models.has(narrative.tableName) && !NON_ORM_OBJECTS.has(narrative.tableName)) {
      errors.push(
        `${narrative.tableName} tiene narrativa pero no existe como modelo ORM. ` +
          'Corrige el tableName o decláralo en NON_ORM_OBJECTS si es una vista o una tabla sin modelo.',
      );
    }
    for (const field of NARRATIVE_FIELDS) {
      const value = narrative[field].trim();
      if (value.length < MIN_FIELD_LENGTH) {
        errors.push(`${narrative.tableName}.${field} tiene ${value.length} caracteres (mínimo ${MIN_FIELD_LENGTH}): parece un stub.`);
      }
    }
  }

  if (errors.length > 0) {
    console.error('❌ Narrativa de gobierno incompleta:');
    errors.forEach((error) => console.error(`   - ${error}`));
    process.exit(1);
  }

  const extras = ENTITY_BUSINESS_NARRATIVES.length - models.size;
  console.log(
    `✅ ${models.size} tablas con modelo ORM tienen narrativa de negocio y sistemas completa ` +
      `(+${extras} objetos sin ORM: vistas y tablas de catálogo).`,
  );
}

main();
