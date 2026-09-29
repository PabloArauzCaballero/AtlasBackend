/**
 * @file Las cifras que la documentación puede citar, CALCULADAS del código en el momento del gate.
 * @business Una cifra en la documentación o es verdad y está vigilada, o no debería estar.
 * @system cuenta rutas, controladores, módulos, modelos, migraciones, tablas, aristas, ciclos, pruebas,
 *   trabajos programados y eventos; y genera las tablas de trabajos de fondo que no se escriben a mano.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import * as yaml from 'js-yaml';
import { envBaseSchema } from '../../../src/config/env.schema.js';
import { ATLAS_DOMAIN_TABLES } from '../../../src/database/domain-tables.js';
import { inventoryImports } from '../../architecture/inventory-imports.js';
import { loadControllerRoutes } from './controller-routes.js';
import { familiesOf, loadEventInventory } from './event-inventory.js';

const ROOT = process.cwd();

export const ALWAYS_JOB_FILES = ['src/modules/runtime-jobs/scheduled-jobs.catalog.ts', 'src/modules/runtime-jobs/scheduled-jobs.credit.ts'];
export const OPTIONAL_JOB_FILE = 'src/modules/runtime-jobs/optional-jobs.catalog.ts';

export type ScheduledJobDoc = {
  jobCode: string;
  file: string;
  intervalEnv: string;
  intervalDefaultMs: number | null;
  condition: string | null;
};

function walk(dir: string, accept: (name: string) => boolean, found: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules') continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, accept, found);
    else if (accept(entry)) found.push(full);
  }
  return found;
}

const read = (path: string): string => readFileSync(resolve(ROOT, path), 'utf8');

/** Default que el esquema de entorno da a una variable (o null si no tiene). */
function envDefault(name: string): number | null {
  const field = (envBaseSchema.shape as Record<string, { safeParse: (value: unknown) => { success: boolean; data?: unknown } }>)[name];
  const parsed = field?.safeParse(undefined);
  return parsed?.success && typeof parsed.data === 'number' ? parsed.data : null;
}

/**
 * Trabajos declarados en un catálogo: cada `jobCode: '…'` seguido de su `intervalMs: env.X`. En el de
 * opcionales, la condición es el `if (…)` más cercano por encima: el mismo texto que decide si existe.
 */
export function scheduledJobsIn(file: string, withCondition: boolean): ScheduledJobDoc[] {
  const source = read(file);
  const jobs: ScheduledJobDoc[] = [];
  for (const match of source.matchAll(/jobCode:\s*'([a-z0-9_]+)',\s*\n\s*intervalMs:\s*env\.([A-Z0-9_]+)/g)) {
    const before = source.slice(0, match.index);
    const conditions = [...before.matchAll(/^\s*if \((.+)\) \{$/gm)];
    jobs.push({
      jobCode: match[1],
      file,
      intervalEnv: match[2],
      intervalDefaultMs: envDefault(match[2]),
      condition: withCondition ? (conditions.at(-1)?.[1] ?? null) : null,
    });
  }
  return jobs;
}

export function scheduledJobs(): { always: ScheduledJobDoc[]; optional: ScheduledJobDoc[] } {
  return { always: ALWAYS_JOB_FILES.flatMap((file) => scheduledJobsIn(file, false)), optional: scheduledJobsIn(OPTIONAL_JOB_FILE, true) };
}

/** Archivos de `src/` (sin pruebas) que arrancan un `setInterval`: trabajo de fondo fuera del planificador. */
export function intervalSources(): Array<{ file: string; flags: string[] }> {
  return walk(resolve(ROOT, 'src'), (name) => name.endsWith('.ts') && !name.endsWith('.spec.ts'))
    .map((full) => ({ file: relative(ROOT, full).replace(/\\/g, '/'), source: readFileSync(full, 'utf8') }))
    .filter(({ source }) => /\bsetInterval\(/.test(source.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '')))
    .map(({ file, source }) => ({
      file,
      flags: [...new Set([...source.matchAll(/env\.([A-Z0-9_]+(?:ENABLED|URL_CONNECTION))/g)].map((m) => m[1]))],
    }))
    .sort((a, b) => a.file.localeCompare(b.file));
}

function openApiCounts(): { paths: number; operations: number } {
  const contract = yaml.load(read('docs/endpoints/openapi.yaml')) as { paths: Record<string, Record<string, unknown>> };
  const methods = new Set(['get', 'post', 'put', 'patch', 'delete', 'head', 'options']);
  const operations = Object.values(contract.paths).reduce(
    (sum, item) => sum + Object.keys(item).filter((key) => methods.has(key)).length,
    0,
  );
  return { paths: Object.keys(contract.paths).length, operations };
}

function moduleCount(): number {
  const dir = resolve(ROOT, 'src/modules');
  return readdirSync(dir).filter((entry) => {
    const full = join(dir, entry);
    return statSync(full).isDirectory() && readdirSync(full).some((file) => file.endsWith('.module.ts'));
  }).length;
}

function architecture(): { moduleEdges: number; cycles: number; cycleExceptions: number } {
  const inventory = inventoryImports({ rootDir: ROOT });
  const moduleEdges = Object.values(inventory.modules).reduce((sum, entry) => sum + entry.imports.length, 0);
  const manifest = JSON.parse(read('config/architecture/boundaries.json')) as { exceptions?: Array<{ kind: string }> };
  const cycleExceptions = (manifest.exceptions ?? []).filter((exception) => exception.kind === 'cycle').length;
  return { moduleEdges, cycles: inventory.cycles.length, cycleExceptions };
}

/** Todas las cifras citables, por clave. La clave es la que va en `<!-- fig:clave -->`. */
export async function computeFigures(): Promise<Record<string, number>> {
  const contract = openApiCounts();
  const { routes, controllers } = await loadControllerRoutes();
  const sourceFiles = walk(resolve(ROOT, 'src'), (name) => name.endsWith('.ts') && !name.endsWith('.spec.ts'));
  const events = loadEventInventory();
  const jobs = scheduledJobs();
  const arch = architecture();
  const tables = Object.values(ATLAS_DOMAIN_TABLES);
  return {
    'openapi.paths': contract.paths,
    'openapi.operations': contract.operations,
    'code.routes': routes.length,
    'code.routesOutsideContract': routes.filter((route) => route.excludedFromContract).length,
    'code.controllers': controllers,
    'code.controllerFiles': walk(resolve(ROOT, 'src'), (name) => name.endsWith('.controller.ts')).length,
    'code.modules': moduleCount(),
    'code.ormModels': sourceFiles.reduce((sum, file) => sum + (readFileSync(file, 'utf8').match(/^@Table\(/gm) ?? []).length, 0),
    'code.migrations': readdirSync(resolve(ROOT, 'src/database/migrations')).filter((name) => /^\d{14}-.+\.ts$/.test(name)).length,
    'db.tables': tables.reduce((sum, list) => sum + list.length, 0),
    'db.schemas': tables.filter((list) => list.length > 0).length,
    'arch.moduleEdges': arch.moduleEdges,
    'arch.cycles': arch.cycles,
    'arch.cycleExceptions': arch.cycleExceptions,
    'tests.specFiles': walk(resolve(ROOT, 'test'), (name) => name.endsWith('.spec.ts')).length,
    'jobs.always': jobs.always.length,
    'jobs.optional': jobs.optional.length,
    'jobs.intervalSources': intervalSources().length,
    'events.codes': events.length,
    'events.families': familiesOf(events).length,
    'events.emitted': events.filter((event) => event.emitted).length,
    'events.reserved': events.filter((event) => !event.emitted).length,
    'events.emittedWithNotification': events.filter((event) => event.emitted && event.notifications.length > 0).length,
  };
}

function human(ms: number | null): string {
  if (ms === null) return 'sin default';
  if (ms % 3_600_000 === 0) return `${ms / 3_600_000} h`;
  if (ms % 60_000 === 0) return `${ms / 60_000} min`;
  return ms % 1000 === 0 ? `${ms / 1000} s` : `${ms} ms`;
}

/** Bloques generados que la documentación incrusta entre `<!-- gen:clave -->` y `<!-- /gen:clave -->`. */
export function generatedBlocks(): Record<string, string> {
  const jobs = scheduledJobs();
  const jobRow = (job: ScheduledJobDoc): string =>
    `| \`${job.jobCode}\` | \`${job.intervalEnv}\` · ${human(job.intervalDefaultMs)} |${job.condition === null ? '' : ` \`${job.condition}\` |`} \`${job.file.replace('src/modules/runtime-jobs/', '')}\` |`;
  return {
    'jobs-always': ['| `jobCode` | Intervalo (variable · default) | Catálogo |', '|---|---|---|', ...jobs.always.map(jobRow)].join('\n'),
    'jobs-optional': [
      '| `jobCode` | Intervalo (variable · default) | Sólo existe si | Catálogo |',
      '|---|---|---|---|',
      ...jobs.optional.map(jobRow),
    ].join('\n'),
    'interval-sources': [
      '| Archivo | Variables que lo encienden o condicionan |',
      '|---|---|',
      ...intervalSources().map(
        (entry) =>
          `| \`${entry.file}\` | ${entry.flags.map((flag) => `\`${flag}\``).join(', ') || '— (sin variable propia: ver el archivo)'} |`,
      ),
    ].join('\n'),
  };
}
