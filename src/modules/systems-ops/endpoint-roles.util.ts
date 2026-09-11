/**
 * @file Utilidad pura: qué roles exige cada ruta según los decoradores de su controlador.
 * @business Esta pieza hace observable y gobernable el propio backend para operaciones, QA y arquitectura.
 * @system reproduce sobre el código fuente la regla de `RolesGuard`: `getAllAndOverride([handler, class])`.
 */
import { SYSTEMS_OPS_ROLE_CONSTANTS } from './systems-ops.constants.js';

export type RoleConstants = Readonly<Record<string, readonly string[]>>;

const LIST_CONSTANT = /(?:^|\n)[ \t]*(?:export\s+)?const\s+([A-Z][A-Z0-9_]*)\s*(?::[^=\n]+)?=\s*\[([^\]]*)\]/g;

/** Sin comentarios: un `@Roles(` citado en un comentario no es un decorador. */
function withoutComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');
}

/** Listas `const NOMBRE = ['a', ...OTRA]` de un fichero, todavía sin resolver. */
export function listConstantsIn(source: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const match of withoutComments(source).matchAll(LIST_CONSTANT)) out[match[1]] = match[2];
  return out;
}

/** Roles de una lista de argumentos. Una constante que no se encuentra se dice (`<unresolved:X>`), no se calla. */
function rolesInList(body: string, lookup: (name: string) => readonly string[] | undefined): string[] {
  const roles = [...body.matchAll(/['"]([^'"]+)['"]/g)].map((match) => match[1]);
  for (const spread of body.matchAll(/\.\.\.([A-Za-z0-9_]+)/g)) roles.push(...(lookup(spread[1]) ?? [`<unresolved:${spread[1]}>`]));
  return [...new Set(roles)];
}

/** Resuelve listas crudas (textos y `...OTRA`) sobre una base ya resuelta; las crudas mandan sobre la base. */
export function resolveRoleConstants(raw: Record<string, string>, base: RoleConstants = SYSTEMS_OPS_ROLE_CONSTANTS): RoleConstants {
  const resolved: Record<string, readonly string[]> = {};
  const resolve = (name: string, seen: Set<string>): readonly string[] | undefined => {
    if (resolved[name]) return resolved[name];
    if (raw[name] === undefined || seen.has(name)) return base[name];
    seen.add(name);
    resolved[name] = rolesInList(raw[name], (other) => resolve(other, seen));
    return resolved[name];
  };
  for (const name of Object.keys(raw)) resolve(name, new Set());
  return { ...base, ...resolved };
}

/**
 * Índice de las listas de todo el código: los `@Roles(...CONSTANTE)` no usan sólo las de Systems Ops. Un nombre declarado
 * en varios ficheros con valores distintos no se adivina; lo resuelve, si acaso, la declaración local del controlador.
 */
export function roleConstantsFromSources(sources: readonly string[]): RoleConstants {
  const raw: Record<string, string> = {};
  const ambiguous = new Set<string>();
  for (const source of sources) {
    for (const [name, body] of Object.entries(listConstantsIn(source))) {
      if (raw[name] !== undefined && raw[name] !== body) ambiguous.add(name);
      raw[name] ??= body;
    }
  }
  for (const name of ambiguous) delete raw[name];
  return resolveRoleConstants(raw);
}

/** Fin de la cabecera `export class X {` dentro del bloque, o 0 si no se encuentra. */
export function classHeaderEnd(classBlock: string): number {
  const header = /export\s+class\s+[A-Za-z0-9_]+[^{]*\{/.exec(classBlock);
  return header ? header.index + header[0].length : 0;
}

/** Decoradores de la CLASE: desde el cierre de lo anterior, así entran también los que van encima de `@Controller`. */
export function classDecorators(source: string, controllerIndex: number, classBlock: string): string {
  return source.slice(source.lastIndexOf('\n}', controllerIndex) + 1, controllerIndex) + classBlock.slice(0, classHeaderEnd(classBlock));
}

/**
 * Decoradores del MÉTODO de una ruta: desde el cierre del miembro anterior —una línea con sólo `  }`— o desde la
 * cabecera. Cortar por cualquier `\n  }` partía en dos un decorador multilínea (`@ApiOperation({ … })`), y el `@Roles`
 * de encima quedaba fuera.
 */
export function methodDecorators(classBlock: string, routeIndex: number): string {
  const before = classBlock.slice(0, routeIndex);
  let start = classHeaderEnd(classBlock);
  for (const close of before.matchAll(/\n {2}\};?[ \t]*(?=\r?\n)/g)) start = Math.max(start, (close.index ?? 0) + close[0].length);
  return before.slice(start);
}

function rolesCall(decorators: string, constants: RoleConstants): string[] | null {
  const call = /@Roles\(([^)]*)\)/.exec(decorators)?.[1];
  return call === undefined ? null : rolesInList(call, (name) => constants[name]);
}

/** Roles de la clase. Nest aplica los decoradores de abajo arriba: manda el más ALTO entre `@Roles` y `@SystemsOpsControllerSecurity`. */
export function classRoles(decorators: string, constants: RoleConstants): string[] | null {
  const text = withoutComments(decorators);
  const roles = text.indexOf('@Roles(');
  const security = text.indexOf('@SystemsOpsControllerSecurity()');
  if (security >= 0 && (roles < 0 || security < roles)) return [...(constants.SYSTEMS_OPS_ROLES ?? [])];
  return roles < 0 ? null : rolesCall(text.slice(roles), constants);
}

/** Como `RolesGuard`: el `@Roles` del método y, sin él, el de la clase. Uno de método sin resolver NO hereda el de la clase. */
export function routeRoles(methodBlock: string, fromClass: string[] | null, constants: RoleConstants): string[] {
  return rolesCall(withoutComments(methodBlock), constants) ?? fromClass ?? [];
}
