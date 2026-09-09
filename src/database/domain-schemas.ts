/**
 * @file Resuelve en qué schema de dominio vive cada tabla.
 * @business Esta pieza preserva la fuente de verdad y la evidencia histórica que soportan decisiones y cumplimiento.
 * @system compone los nombres de schema y el inventario para responder «¿dónde vive esta tabla?».
 */
import { ATLAS_SCHEMAS, type AtlasSchema } from './atlas-schemas.js';
import { ATLAS_DOMAIN_TABLES } from './domain-tables.js';

/**
 * Los nombres viven en `atlas-schemas.ts` y el inventario en `domain-tables.ts`; aquí queda la
 * REGLA, que es lo corto y lo estable. Se re-exportan los dos para que ningún importador existente
 * tenga que cambiar de ruta: este archivo sigue siendo la puerta de entrada.
 *
 * `public` queda reservado para el tracking de Umzug y la compatibilidad de infraestructura: ningún
 * modelo Sequelize de negocio debe resolver allí.
 */
export { ATLAS_SCHEMAS, ATLAS_DOMAIN_TABLES };
export type { AtlasSchema };

const TABLE_TO_SCHEMA = new Map<string, AtlasSchema>(
  Object.entries(ATLAS_DOMAIN_TABLES).flatMap(([schema, tables]) => tables.map((table) => [table, schema as AtlasSchema])),
);

export const ATLAS_RUNTIME_SEARCH_PATH = [...Object.values(ATLAS_SCHEMAS), 'read_api', 'public'] as const;
export const ATLAS_MIGRATION_SEARCH_PATH = ['public', ...Object.values(ATLAS_SCHEMAS), 'read_api'] as const;

export function atlasSchemaFor(tableName: string): AtlasSchema {
  const schema = TABLE_TO_SCHEMA.get(tableName);
  if (!schema) throw new Error(`La tabla ${tableName} no está registrada en ATLAS_DOMAIN_TABLES.`);
  return schema;
}
