/** Gate estático: todos los modelos ORM deben declarar un schema de dominio registrado. */
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ATLAS_DOMAIN_TABLES, atlasSchemaFor } from '../src/database/domain-schemas.js';

const MODELS_DIR = resolve(process.cwd(), 'src/database/models');
const TABLE_DECORATOR = /@Table\(\{\s*tableName:\s*'([^']+)'[^}]*\}\)/;
const EXPLICIT_SCHEMA = /schema:\s*atlasSchemaFor\('([^']+)'\)/;

function main(): void {
  const errors: string[] = [];
  const ownership = new Map<string, string>();

  for (const [schema, tables] of Object.entries(ATLAS_DOMAIN_TABLES)) {
    for (const table of tables) {
      const previous = ownership.get(table);
      if (previous) errors.push(`${table} está registrado en ${previous} y ${schema}.`);
      ownership.set(table, schema);
    }
  }

  let modelCount = 0;
  for (const file of readdirSync(MODELS_DIR).filter((entry) => entry.endsWith('.model.ts'))) {
    const source = readFileSync(resolve(MODELS_DIR, file), 'utf8');
    const table = source.match(TABLE_DECORATOR)?.[1];
    if (!table) continue;
    modelCount += 1;
    const schemaTable = source.match(EXPLICIT_SCHEMA)?.[1];
    if (schemaTable !== table) errors.push(`${file}: @Table debe usar schema: atlasSchemaFor('${table}').`);
    try {
      atlasSchemaFor(table);
    } catch (error) {
      errors.push(`${file}: ${(error as Error).message}`);
    }
  }

  if (errors.length > 0) {
    console.error('❌ Configuración de schemas de dominio inválida:');
    errors.forEach((error) => console.error(`   - ${error}`));
    process.exit(1);
  }

  console.log(`✅ ${modelCount} modelos ORM usan schemas de dominio explícitos; ninguna tabla de negocio depende de public.`);
}

main();
