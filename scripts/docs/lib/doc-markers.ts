/**
 * @file Piezas puras de los gates de documentación: marcas `fig`/`gen`, comandos `yarn` y rutas citadas.
 * @business Permite probar los gates sin tocar archivos: qué cuenta como cifra marcada, comando o ruta.
 * @system sin E/S; lo usan `scripts/docs/check-docs-figures.ts` y `scripts/docs/check-doc-routes.ts`.
 */
import { routeShape } from './route-shape.js';

/** Comandos propios de yarn (v1), que no son scripts del proyecto. */
const YARN_BUILTINS = new Set([
  'add',
  'audit',
  'autoclean',
  'bin',
  'cache',
  'config',
  'create',
  'dlx',
  'exec',
  'global',
  'help',
  'info',
  'init',
  'install',
  'licenses',
  'link',
  'list',
  'node',
  'outdated',
  'owner',
  'pack',
  'publish',
  'remove',
  'run',
  'unlink',
  'upgrade',
  'upgrade-interactive',
  'version',
  'versions',
  'why',
  'workspace',
  'workspaces',
]);

export const FIGURE = /<!-- fig:([\w.-]+) -->([^<]*)<!-- \/fig -->/g;
/** El contenido del bloque va de la línea siguiente a la marca de apertura hasta la de cierre (vacío incluido). */
export const BLOCK = /<!-- gen:([\w-]+) -->\n([\s\S]*?)<!-- \/gen:\1 -->/g;

export function rewriteMarkers(
  markdown: string,
  figures: Readonly<Record<string, number>>,
  blocks: Readonly<Record<string, string>>,
): { text: string; unknown: string[] } {
  const unknown: string[] = [];
  const text = markdown
    .replace(FIGURE, (whole, key: string) => {
      if (!(key in figures)) {
        unknown.push(`fig:${key}`);
        return whole;
      }
      return `<!-- fig:${key} -->${figures[key]}<!-- /fig -->`;
    })
    .replace(BLOCK, (whole, key: string) => {
      if (!(key in blocks)) {
        unknown.push(`gen:${key}`);
        return whole;
      }
      return `<!-- gen:${key} -->\n${blocks[key]}\n<!-- /gen:${key} -->`;
    });
  return { text, unknown };
}

/** Diferencias legibles entre lo versionado y lo recalculado, marca a marca. */
export function describeDrift(current: string, expected: string): string[] {
  const values = (text: string): Map<string, string> =>
    new Map([
      ...[...text.matchAll(FIGURE)].map((m) => [`fig:${m[1]}`, m[2]] as const),
      ...[...text.matchAll(BLOCK)].map((m) => [`gen:${m[1]}`, m[2]] as const),
    ]);
  const have = values(current);
  const drift: string[] = [];
  for (const [key, value] of values(expected)) {
    if (have.get(key) !== value)
      drift.push(
        key.startsWith('fig:') ? `${key}: dice ${have.get(key)}, el código da ${value}` : `${key}: la tabla no coincide con el código`,
      );
  }
  return drift;
}

/** `yarn <x>` dentro de un fragmento de código; `yarn run <x>` se lee como `<x>`. */
export function yarnCommands(code: string): string[] {
  const found: string[] = [];
  for (const match of code.matchAll(/(?:^|[\s;&|(`$])yarn\s+(?:run\s+)?([A-Za-z][\w:.-]*\*?)/g)) found.push(match[1]);
  return found;
}

export function isKnownCommand(command: string, known: { scripts: Set<string>; binaries: Set<string> }): boolean {
  if (command.endsWith('*')) {
    const prefix = command.slice(0, -1);
    return [...known.scripts].some((script) => script.startsWith(prefix));
  }
  return known.scripts.has(command) || YARN_BUILTINS.has(command) || known.binaries.has(command);
}

const METHOD_ROUTE = /^(GET|POST|PUT|PATCH|DELETE)\s+(\/[^\s`?#]*)/;
const PREFIX_SUFFIX = /\/(?:\*|\.\.\.|…)$/;

export type RouteReference = { method: string; path: string; prefix: boolean };

/** Ruta citada en un span, o null si el span no empieza por `MÉTODO /ruta`. */
export function routeReference(code: string): RouteReference | null {
  const match = METHOD_ROUTE.exec(code.trim());
  if (!match) return null;
  const prefix = PREFIX_SUFFIX.test(match[2]);
  return { method: match[1], path: prefix ? match[2].replace(PREFIX_SUFFIX, '') : match[2], prefix };
}

export function referenceExists(reference: RouteReference, known: ReadonlySet<string>): boolean {
  const shape = routeShape(reference.path);
  const key = `${reference.method} ${shape}`;
  if (!reference.prefix) return known.has(key);
  return [...known].some((route) => route === key || route.startsWith(`${key}/`));
}
