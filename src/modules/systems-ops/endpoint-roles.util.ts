/**
 * @file Utilidad pura: qué roles exige cada ruta según los decoradores de su controlador.
 * @business Esta pieza hace observable y gobernable el propio backend para operaciones, QA y arquitectura.
 * @system reproduce sobre el código fuente la regla de `RolesGuard`: `getAllAndOverride([handler, class])`.
 */
import { SYSTEMS_OPS_ROLE_CONSTANTS } from './systems-ops.constants.js';

export type RoleConstants = Readonly<Record<string, readonly string[]>>;

const LIST_CONSTANT = /(?:^|\n)[ \t]*(?:export\s+)?const\s+([A-Z][A-Z0-9_]*)\s*(?::[^=\n]+)?=\s*\[([^\]]*)\]/g;

/**
 * Sin comentarios: un `@Roles(` citado en un comentario no es un decorador, y un `]` dentro de un comentario al final
 * de línea cortaba la lista de roles por la mitad. El `//` de un `http://` no cuenta: va pegado a `:`.
 */
function withoutComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1');
}

/** Listas `const NOMBRE = ['a', ...OTRA]` de un fichero, todavía sin resolver. */
export function listConstantsIn(source: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const match of withoutComments(source).matchAll(LIST_CONSTANT)) out[match[1]] = match[2];
  return out;
}

/** Roles de una lista de argumentos. Una constante que no se encuentra se dice (`<unresolved:X>`), no se calla. */
function rolesInList(body: string, lookup: (name: string) => readonly string[] | undefined): string[] {
  const limpio = withoutComments(body);
  const roles = [...limpio.matchAll(/['"]([^'"]+)['"]/g)].map((match) => match[1]);
  for (const spread of limpio.matchAll(/\.\.\.([A-Za-z0-9_$]+)/g)) roles.push(...(lookup(spread[1]) ?? [`<unresolved:${spread[1]}>`]));
  // Un elemento que no es texto ni propagación (`ROLE.ADMIN`, `rolesDe()`) no es un rol conocido: se dice. Callarlo
  // dejaba la ruta con lista vacía, que el catálogo lee como «sin restricción», que es lo contrario de lo que ocurre.
  for (const suelto of limpio.replace(/\.\.\.[A-Za-z0-9_$]+/g, '').matchAll(/(?:^|,)\s*([A-Za-z_$][\w$]*(?:\.[\w$]+)*)\s*(?=,|$)/g)) {
    roles.push(`<unresolved:${suelto[1]}>`);
  }
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
  // Una a cuatro espacios o un tabulador: el cierre de un miembro. Con sólo dos, una clase indentada con cuatro (o con
  // tabuladores) no cerraba ningún método y la segunda ruta heredaba el `@Roles` de la primera.
  for (const close of before.matchAll(/\n(?: {1,4}|\t+)\};?[ \t]*(?=\r?\n)/g))
    start = Math.max(start, (close.index ?? 0) + close[0].length);
  return before.slice(start);
}

/**
 * Decoradores COMPUESTOS del propio repositorio: `export function X() { return applyDecorators(Roles(...)) }`. Nest los
 * aplica como si fueran el `@Roles` que envuelven, así que ignorarlos dejaba la ruta con lista vacía —«sin
 * restricción»— justo donde sí había una.
 */
/** El argumento de una llamada, contando paréntesis desde `abre`; null si no cierra. */
function argumentoDe(texto: string, abre: number): string | null {
  let profundidad = 0;
  for (let i = abre; i < texto.length; i += 1) {
    if (texto[i] === '(') profundidad += 1;
    else if (texto[i] === ')') {
      profundidad -= 1;
      if (profundidad === 0) return texto.slice(abre + 1, i);
    }
  }
  return null;
}

export function composedRoleDecorators(sources: readonly string[], constants: RoleConstants): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const source of sources) {
    const limpio = withoutComments(source);
    for (const fn of limpio.matchAll(/export\s+(?:const|function)\s+([A-Za-z_$][\w$]*)/g)) {
      const desde = (fn.index ?? 0) + fn[0].length;
      const llamada = limpio.indexOf('applyDecorators(', desde);
      // Dentro de ESTA declaración: hasta la siguiente `export`, para que el `applyDecorators` de la de abajo no se
      // atribuya a ésta. Y el argumento se lee contando paréntesis, no con un tope de caracteres ni un cierre en una
      // línea suelta: escrito todo en una línea, el compuesto se perdía y su ruta quedaba «sin restricción».
      const siguiente = limpio.indexOf('\nexport ', desde);
      if (llamada < 0 || (siguiente >= 0 && llamada > siguiente)) continue;
      const argumento = argumentoDe(limpio, llamada + 'applyDecorators'.length);
      const roles = argumento === null ? null : /\bRoles\(([^)]*)\)/.exec(argumento);
      if (roles) out[fn[1]] = rolesInList(roles[1], (name) => constants[name]);
    }
  }
  return out;
}

function rolesCall(decorators: string, constants: RoleConstants, composed: Record<string, string[]> = {}): string[] | null {
  const propio = /@Roles\(([^)]*)\)/.exec(decorators);
  const compuesto = Object.keys(composed)
    .map((name) => ({ name, index: decorators.indexOf(`@${name}(`) }))
    .filter((c) => c.index >= 0)
    .sort((a, b) => a.index - b.index)[0];
  // Nest aplica de abajo arriba: manda el de más arriba en el texto.
  if (propio && (!compuesto || propio.index < compuesto.index)) return rolesInList(propio[1], (name) => constants[name]);
  if (compuesto) return [...composed[compuesto.name]];
  return null;
}

/** Roles de la clase. Nest aplica los decoradores de abajo arriba: manda el más ALTO entre `@Roles` y `@SystemsOpsControllerSecurity`. */
export function classRoles(decorators: string, constants: RoleConstants, composed: Record<string, string[]> = {}): string[] | null {
  return rolesCall(withoutComments(decorators), constants, composed);
}

/** Como `RolesGuard`: el `@Roles` del método y, sin él, el de la clase. Uno de método sin resolver NO hereda el de la clase. */
export function routeRoles(
  methodBlock: string,
  fromClass: string[] | null,
  constants: RoleConstants,
  composed: Record<string, string[]> = {},
): string[] {
  return [...new Set(rolesCall(withoutComments(methodBlock), constants, composed) ?? fromClass ?? [])];
}
