/**
 * Verifica que la plantilla local documente todo el contrato tipado de configuración.
 *
 * Las variables dinámicas de proveedores/OTel pueden existir solo en `.env.example`, pero ninguna
 * clave del esquema Zod puede faltar ni aparecer duplicada: ambas situaciones generan despliegues
 * difíciles de reproducir y documentación engañosa.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { envBaseSchema } from '../src/config/env.schema.js';

function templateKeys(source: string): string[] {
  return source
    .split(/\r?\n/)
    .map((line) => line.match(/^([A-Z][A-Z0-9_]*)=/)?.[1])
    .filter((key): key is string => key !== undefined);
}

function duplicates(keys: string[]): string[] {
  const counts = new Map<string, number>();
  for (const key of keys) counts.set(key, (counts.get(key) ?? 0) + 1);
  return [...counts.entries()]
    .filter(([, count]) => count > 1)
    .map(([key]) => key)
    .sort();
}

function main(): void {
  const examplePath = resolve(process.cwd(), '.env.example');
  const productionExamplePath = resolve(process.cwd(), '.env.production.example');
  const keys = templateKeys(readFileSync(examplePath, 'utf-8'));
  const productionKeys = templateKeys(readFileSync(productionExamplePath, 'utf-8'));
  const present = new Set(keys);
  const schemaKeys = envBaseSchema.keyof().options;
  const missing = schemaKeys.filter((key) => !present.has(key)).sort();
  const repeated = duplicates(keys);
  const repeatedInProduction = duplicates(productionKeys);

  if (missing.length > 0 || repeated.length > 0 || repeatedInProduction.length > 0) {
    console.error('❌ Las plantillas de entorno no representan un contrato íntegro.');
    if (missing.length > 0) console.error(`   Faltan: ${missing.join(', ')}`);
    if (repeated.length > 0) console.error(`   Duplicadas en .env.example: ${repeated.join(', ')}`);
    if (repeatedInProduction.length > 0) console.error(`   Duplicadas en .env.production.example: ${repeatedInProduction.join(', ')}`);
    process.exit(1);
  }

  console.log(`✅ .env.example cubre ${schemaKeys.length} variables tipadas; ambas plantillas están libres de duplicados.`);
}

main();
