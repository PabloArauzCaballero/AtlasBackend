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
import ts from 'typescript';

const ROOT = process.cwd();
const SRC_ROOT = resolve(ROOT, 'src');

function tsFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return tsFiles(full);
    return full.endsWith('.ts') ? [full] : [];
  });
}

/** `<algo>.coerce.boolean(...)`, mirado en el árbol sintáctico y no en el texto. */
function isCoerceBooleanCall(node: ts.Node): boolean {
  if (!ts.isCallExpression(node) || !ts.isPropertyAccessExpression(node.expression)) return false;
  const callee = node.expression;
  return callee.name.text === 'boolean' && ts.isPropertyAccessExpression(callee.expression) && callee.expression.name.text === 'coerce';
}

/**
 * Líneas (desde 1) donde se LLAMA a la coerción. Se recorre el AST en vez de buscar el texto porque
 * los comentarios que explican por qué no se usa —«`booleanEnvSchema` y no `z.coerce.boolean()`»—
 * nombran la llamada sin hacerla, y con una búsqueda de texto el gate castigaba justo esa explicación.
 * El AST también cubre los eslabones partidos en varias líneas (`z.coerce\n  .boolean()`).
 */
function findCoerceBoolean(file: string, source: string): number[] {
  const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  const lines: number[] = [];
  const visit = (node: ts.Node): void => {
    if (isCoerceBooleanCall(node)) {
      lines.push(sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return lines;
}

function main(): void {
  const offenders = tsFiles(SRC_ROOT).flatMap((file) =>
    findCoerceBoolean(file, readFileSync(file, 'utf-8')).map((line) => `${relative(ROOT, file)}:${line}`),
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
