/**
 * Gate de tamaño de archivos runtime (Fase 2.1 del plan 10/10).
 *
 * Objetivo: CONGELAR la deuda, no romper el build por lo que ya existe. Por eso funciona como un
 * trinquete contra un baseline versionado (`.file-size-baseline.json`):
 *
 *   - Un archivo runtime NUEVO con más de 300 líneas  -> ERROR (no entra deuda nueva).
 *   - Un archivo del baseline que CRECE               -> ERROR (la deuda no empeora).
 *   - Un archivo del baseline aún sobre el límite     -> WARN  (deuda pendiente de dividir).
 *   - Un archivo del baseline que ADELGAZA            -> INFO  (corre `--update-baseline` para fijar la mejora).
 *
 * Exentos (datos declarativos, como define la auditoría del repo): migraciones, seeders, fixtures,
 * seed-data y constants — más líneas ahí no implica menos revisable, a diferencia del código con
 * lógica de control.
 *
 * Uso:
 *   yarn check:file-size
 *   yarn check:file-size --update-baseline   # tras dividir un archivo, fija el nuevo piso
 */
import { readdirSync, readFileSync, statSync, writeFileSync, existsSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

const SRC_ROOT = resolve(process.cwd(), 'src');
const BASELINE_PATH = resolve(process.cwd(), '.file-size-baseline.json');
const LIMIT = 300;

const EXEMPT_DIRS = ['src/database/migrations/', 'src/database/seeders/'];
const EXEMPT_SUFFIXES = ['.fixtures.ts', '.seed-data.ts', '.constants.ts'];

function toPosix(p: string): string {
  return p.split('\\').join('/');
}

function isExempt(relPath: string): boolean {
  if (EXEMPT_DIRS.some((dir) => relPath.startsWith(dir))) return true;
  return EXEMPT_SUFFIXES.some((suffix) => relPath.endsWith(suffix));
}

function walk(directory: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(directory)) {
    const full = join(directory, entry);
    if (statSync(full).isDirectory()) files.push(...walk(full));
    else if (entry.endsWith('.ts')) files.push(full);
  }
  return files;
}

function countLines(file: string): number {
  return readFileSync(file, 'utf8').split(/\r?\n/).length;
}

function collect(): Map<string, number> {
  const result = new Map<string, number>();
  for (const file of walk(SRC_ROOT)) {
    const rel = toPosix(relative(process.cwd(), file));
    if (isExempt(rel)) continue;
    result.set(rel, countLines(file));
  }
  return result;
}

function loadBaseline(): Record<string, number> {
  if (!existsSync(BASELINE_PATH)) return {};
  return JSON.parse(readFileSync(BASELINE_PATH, 'utf8')) as Record<string, number>;
}

function updateBaseline(current: Map<string, number>): void {
  const offenders: Record<string, number> = {};
  for (const [file, lines] of [...current.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    if (lines > LIMIT) offenders[file] = lines;
  }
  writeFileSync(BASELINE_PATH, `${JSON.stringify(offenders, null, 2)}\n`, 'utf8');
  console.log(`✅ Baseline actualizado: ${Object.keys(offenders).length} archivos runtime sobre ${LIMIT} líneas.`);
}

function main(): void {
  const current = collect();

  if (process.argv.includes('--update-baseline')) {
    updateBaseline(current);
    return;
  }

  const baseline = loadBaseline();
  const errors: string[] = [];
  const warnings: string[] = [];
  const improvements: string[] = [];

  for (const [file, lines] of current) {
    const frozen = baseline[file];

    if (lines > LIMIT && frozen === undefined) {
      errors.push(
        `${file}: ${lines} líneas (límite ${LIMIT}). Archivo runtime NUEVO por encima del límite: divídelo o documenta la excepción en .file-size-baseline.json.`,
      );
      continue;
    }

    if (frozen !== undefined && lines > frozen) {
      errors.push(`${file}: creció de ${frozen} a ${lines} líneas. La deuda congelada no puede empeorar; divide el archivo.`);
      continue;
    }

    if (frozen !== undefined && lines > LIMIT) {
      warnings.push(`${file}: ${lines} líneas (deuda congelada, objetivo ${LIMIT}).`);
    }

    if (frozen !== undefined && lines < frozen) {
      improvements.push(`${file}: ${frozen} -> ${lines} líneas.`);
    }
  }

  for (const file of Object.keys(baseline)) {
    if (!current.has(file)) improvements.push(`${file}: ya no existe (eliminado o renombrado).`);
  }

  if (improvements.length > 0) {
    console.log(
      `ℹ️  ${improvements.length} archivo(s) mejoraron. Corre "yarn check:file-size --update-baseline" para fijar el nuevo piso:`,
    );
    improvements.slice(0, 10).forEach((line) => console.log(`   - ${line}`));
  }

  if (warnings.length > 0) {
    console.warn(`⚠️  ${warnings.length} archivo(s) runtime siguen sobre ${LIMIT} líneas (deuda congelada, pendiente de dividir).`);
  }

  if (errors.length > 0) {
    console.error('❌ Gate de tamaño de archivos runtime:');
    errors.forEach((error) => console.error(`   - ${error}`));
    process.exit(1);
  }

  console.log(`✅ Gate de tamaño OK: sin archivos runtime nuevos sobre ${LIMIT} líneas ni crecimiento de la deuda congelada.`);
}

main();
