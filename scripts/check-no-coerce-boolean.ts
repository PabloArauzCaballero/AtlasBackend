/**
 * Gate: prohíbe la coerción booleana de Zod (`z.coerce` + `.boolean()`) en `src/`.
 *
 * FND-CORE-01: esa coerción es `Boolean(valor)`, así que el TEXTO `"false"` —el que llega siempre
 * desde una variable de entorno o una query string— se lee `true`. Así se encendía el consumidor de
 * estrés con `RUNTIME_JOBS_STRESS_CONSUMER_ENABLED=false` y se invertían filtros como
 * `?assignedToMe=false`, sin un solo error. Los reemplazos son explícitos:
 *
 *   - Entorno: `booleanEnvSchema` / `optionalBooleanEnvSchema` (`src/config/env.primitives.ts`).
 *   - Query:   `queryBooleanSchema` (`src/common/pipes/query-boolean.schema.ts`): sólo true/false/1/0.
 *   - Body JSON: `z.boolean()`; un booleano de JSON ya llega tipado y no hay nada que coercionar.
 *
 * Uso: `yarn check:no-coerce-boolean`. Estático, sin base ni red: milisegundos.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

const ROOT = process.cwd();
const SRC_ROOT = resolve(ROOT, 'src');
// Tolera espacios y saltos de línea entre los eslabones (`z.coerce\n  .boolean()`).
const PATTERN = /\bcoerce\s*\.\s*boolean\s*\(/g;

function tsFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return tsFiles(full);
    return full.endsWith('.ts') ? [full] : [];
  });
}

function findCoerceBoolean(source: string): number[] {
  const lines: number[] = [];
  for (const match of source.matchAll(PATTERN)) {
    lines.push(source.slice(0, match.index).split('\n').length);
  }
  return lines;
}

function main(): void {
  const offenders = tsFiles(SRC_ROOT).flatMap((file) =>
    findCoerceBoolean(readFileSync(file, 'utf-8')).map((line) => `${relative(ROOT, file)}:${line}`),
  );

  if (offenders.length > 0) {
    console.error('❌ z.coerce.boolean() en src/: el texto "false" se lee como true.');
    offenders.forEach((where) => console.error(`   - ${where}`));
    console.error('   Usa booleanEnvSchema (entorno), queryBooleanSchema (query) o z.boolean() (body JSON).');
    process.exit(1);
  }

  console.log('✅ Sin z.coerce.boolean() en src/: los booleanos de texto se parsean de forma estricta.');
}

main();
