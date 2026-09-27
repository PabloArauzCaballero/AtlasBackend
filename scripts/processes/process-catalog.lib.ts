/**
 * @file Utilidades compartidas por los gates del catálogo de procesos (`check:process-*`, `docs:processes`).
 * @business Esta pieza hace que «documentado» sea una comprobación y no una opinión: todos los gates miran las mismas fixtures con las mismas reglas.
 * @system inventario de rutas del Backend por decoradores, endpoints de los otros bloques (copia de Flow Intelligence), eventos y jobs.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { WORKFLOW_DEFINITIONS } from '../../src/modules/workflow-catalog/definitions/workflow-definitions.registry.js';
import type {
  ProcessStepFixture,
  WorkflowDefinitionFixture,
} from '../../src/modules/workflow-catalog/definitions/workflow-definition.types.js';

export const ROOT = process.cwd();
/**
 * Por defecto, el registro. Con `PROCESS_FIXTURES=a.ts,b.ts` los gates miran sólo esos ficheros: sirve
 * para validar un proceso que se está escribiendo antes de darlo de alta en el registro.
 */
function loadFixtures(): readonly WorkflowDefinitionFixture[] {
  const files = process.env.PROCESS_FIXTURES?.split(',').filter(Boolean);
  if (!files?.length) return WORKFLOW_DEFINITIONS;
  const load = createRequire(__filename);
  return files.flatMap((file) =>
    Object.values(load(resolve(ROOT, file)) as Record<string, unknown>).filter(
      (v): v is WorkflowDefinitionFixture => typeof v === 'object' && v !== null && 'processId' in v && 'stages' in v,
    ),
  );
}
export const FIXTURES: readonly WorkflowDefinitionFixture[] = loadFixtures();

/** `:customerId`, `${id}`, `{id}` → `:p`; sin barra final. */
export function normalizeRoute(route: string): string {
  return (
    `/${route}`
      .replace(/\/+/g, '/')
      .replace(/\$\{[^}]*\}|\{[^}]+\}|:[A-Za-z0-9_]+/g, ':p')
      .replace(/\/$/, '') || '/'
  );
}

function controllerFiles(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) found.push(...controllerFiles(path));
    else if (entry.endsWith('.controller.ts')) found.push(path);
  }
  return found;
}

/**
 * `MÉTODO /ruta` del Backend a partir de `@Controller('x')` + `@Get('y')`. Mismo extractor que
 * `test/unit/database/flujos-documentados.spec.ts`: un fichero puede declarar varios controladores.
 */
export function backendRoutes(): Set<string> {
  const routes = new Set<string>();
  for (const file of controllerFiles(join(ROOT, 'src', 'modules'))) {
    const source = readFileSync(file, 'utf8');
    const marks = [...source.matchAll(/@Controller\(\s*(?:['"`]([^'"`]*)['"`])?\s*\)/g)];
    const chunks = marks.map((mark, i) => ({
      prefix: mark[1] ?? '',
      body: source.slice(mark.index ?? 0, marks[i + 1]?.index ?? source.length),
    }));
    for (const chunk of chunks.length ? chunks : [{ prefix: '', body: source }]) {
      for (const m of chunk.body.matchAll(/@(Get|Post|Put|Patch|Delete)\(\s*(?:['"`]([^'"`]*)['"`])?\s*\)/g)) {
        routes.add(`${m[1]!.toUpperCase()} ${normalizeRoute([chunk.prefix, m[2] ?? ''].filter(Boolean).join('/'))}`);
      }
    }
  }
  return routes;
}

/** Endpoints de Motor, ERP y Tableros, copiados del artefacto de Flow Intelligence. */
export function externalRoutes(): Map<string, Set<string>> {
  const doc = JSON.parse(readFileSync(join(ROOT, 'docs/processes/external-endpoints.json'), 'utf8')) as {
    systems: Record<string, string[]>;
  };
  return new Map(
    Object.entries(doc.systems).map(([system, list]) => [
      system,
      new Set(
        list.map((entry) => {
          const [method, path] = entry.split(' ');
          return `${method} ${normalizeRoute(path ?? '/')}`;
        }),
      ),
    ]),
  );
}

/** Roles del decorador de cada ruta, por bloque (resueltos por Flow Intelligence). */
export function routeRoles(): Map<string, Map<string, Set<string>>> {
  const doc = JSON.parse(readFileSync(join(ROOT, 'docs/processes/external-endpoints.json'), 'utf8')) as {
    roles?: Record<string, Record<string, string[]>>;
  };
  return new Map(
    Object.entries(doc.roles ?? {}).map(([system, routes]) => [
      system,
      new Map(
        Object.entries(routes).map(([entry, roles]) => {
          const [method, path] = entry.split(' ');
          return [`${method} ${normalizeRoute(path ?? '/')}`, new Set(roles)];
        }),
      ),
    ]),
  );
}

/** Pantallas de cada cliente según Flow Intelligence (rutas con `:param`). */
export function clientScreens(): Map<string, Set<string>> {
  const doc = JSON.parse(readFileSync(join(ROOT, 'docs/processes/external-endpoints.json'), 'utf8')) as {
    screens?: Record<string, string[]>;
  };
  return new Map(Object.entries(doc.screens ?? {}).map(([client, routes]) => [client, new Set(routes.map((r) => normalizeRoute(r)))]));
}

/** Códigos de job declarados en el catálogo de jobs programados del Backend. */
export function backendJobCodes(): Set<string> {
  const source = readFileSync(join(ROOT, 'src/modules/runtime-jobs/scheduled-jobs.catalog.ts'), 'utf8');
  return new Set([...source.matchAll(/jobCode:\s*'([^']+)'/g)].map((m) => m[1]!));
}

/** Códigos de evento del registro del Backend (sin importar el módulo: el gate corre sin Nest). */
export function backendEventCodes(): Set<string> {
  const source = readFileSync(join(ROOT, 'src/modules/events/event-registry.ts'), 'utf8');
  return new Set([...source.matchAll(/'([a-z][a-z0-9_]*(?:\.[a-z0-9_]+)+)'/g)].map((m) => m[1]!));
}

/**
 * Eventos que el código EMITE (o nombra al consumirlos), estén o no en el registro: literales de
 * `src/` y prefijos de plantillas (`customer.lifecycle.${estado}`). Fuera quedan las fixtures y la
 * siembra, que son justo lo que se está comprobando.
 */
export function backendEmittedEvents(): { literals: Set<string>; prefixes: string[] } {
  const literals = new Set<string>();
  const prefixes: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir)) {
      const path = join(dir, entry);
      if (statSync(path).isDirectory()) {
        if (!/workflow-catalog[\\/]definitions|seeders/.test(path)) walk(path);
      } else if (entry.endsWith('.ts')) {
        const source = readFileSync(path, 'utf8');
        for (const m of source.matchAll(/'([a-z][a-z0-9_]*(?:\.[a-z0-9_]+)+)'/g)) literals.add(m[1]!);
        for (const m of source.matchAll(/`([a-z][a-z0-9_]*(?:\.[a-z0-9_]+)*\.)\$\{/g)) prefixes.push(m[1]!);
      }
    }
  };
  walk(join(ROOT, 'src'));
  return { literals, prefixes };
}

export type StepRef = { fixture: WorkflowDefinitionFixture; stage: string; step: ProcessStepFixture };

export function stepsOf(fixture: WorkflowDefinitionFixture): StepRef[] {
  return fixture.stages.flatMap((stage) => stage.steps.map((step) => ({ fixture, stage: stage.code, step })));
}

/** Imprime el resultado de un gate y termina con el código correcto. Un gate sin nada que mirar falla. */
export function finish(gate: string, errors: string[], warnings: string[], looked: number): void {
  for (const w of warnings) console.warn(`AVISO  ${w}`);
  for (const e of errors) console.error(`ERROR  ${e}`);
  if (looked === 0) {
    console.error(`ERROR  ${gate}: no hay nada que comprobar; un verde sin contenido no vale.`);
    process.exit(1);
  }
  console.log(`${gate}: ${looked} revisados, ${errors.length} errores, ${warnings.length} avisos.`);
  process.exit(errors.length ? 1 : 0);
}
