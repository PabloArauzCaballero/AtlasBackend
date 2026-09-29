/**
 * @file Inventario de rutas HTTP leído de la METADATA de los controladores, no de su texto.
 * @business La matriz de permisos y los gates de documentación dicen lo que Nest aplica de verdad.
 * @system importa cada `*.controller.ts` de `src/` y lee con `Reflect` lo mismo que leen los guards
 *   (`getAllAndOverride([handler, class])`): ruta, método, roles, permisos finos, `@Public`, guards.
 *
 * Por qué metadata y no expresiones regulares sobre el código: un `@Roles(...SCHEMA_WRITE_ROLES)`, un
 * decorador compuesto (`SystemsOpsControllerSecurity`) o un `@Controller(['a', 'b'])` sólo se resuelven
 * bien ejecutando los decoradores. `tsx` los ejecuta; lo único que no emite es `design:paramtypes`, que
 * este inventario no necesita (no instancia nada ni abre conexiones).
 */
import 'reflect-metadata';
import { readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { RequestMethod } from '@nestjs/common';
import { GUARDS_METADATA, METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants.js';
import { DECORATORS } from '@nestjs/swagger';
import { IS_PUBLIC_KEY } from '../../../src/common/decorators/public.decorator.js';
import { ROLES_KEY } from '../../../src/common/decorators/roles.decorator.js';
import { SERVICE_SCOPE_KEY } from '../../../src/common/guards/service-token.guard.js';
import { SIGNED_EVENT_SOURCE_KEY } from '../../../src/modules/erp-integration/signed-event.guard.js';
import { INTERNAL_PERMISSIONS_KEY } from '../../../src/modules/internal-users/internal-permissions.decorator.js';

export type ControllerRoute = {
  /** `GET`, `POST`… */
  method: string;
  /** Ruta sin el prefijo global (`/api/v1`), con parámetros al estilo Nest: `/customers/:customerId`. */
  path: string;
  controller: string;
  handler: string;
  /** Archivo del controlador, relativo a la raíz del repositorio. */
  file: string;
  roles: string[];
  internalPermissions: string[];
  isPublic: boolean;
  /** Regla de identidad de servicio (`@ServiceScope`), si la hay. */
  serviceScope: unknown;
  /** Productor exigido por `@SignedEventSource`, si lo hay. */
  signedEventSource: string | null;
  /** Nombres de los guards declarados en el handler o en la clase (`@UseGuards`). */
  guards: string[];
  /** `@ApiExcludeController` / `@ApiExcludeEndpoint`: montada, pero fuera del contrato OpenAPI. */
  excludedFromContract: boolean;
};

type Handler = (...args: unknown[]) => unknown;
type ControllerClass = { name: string; prototype: Record<string, unknown> };

const ROOT = process.cwd();

function controllerFiles(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) controllerFiles(full, found);
    else if (entry.endsWith('.controller.ts')) found.push(full);
  }
  return found.sort();
}

/** `getAllAndOverride`: manda el handler; si no declara nada, la clase. */
function override<T>(key: string, handler: Handler, target: ControllerClass): T | undefined {
  const fromHandler = Reflect.getMetadata(key, handler) as T | undefined;
  return fromHandler !== undefined ? fromHandler : (Reflect.getMetadata(key, target) as T | undefined);
}

function asList(value: unknown): string[] {
  if (value === undefined || value === null) return [''];
  return (Array.isArray(value) ? value : [value]).map((item) => String(item));
}

export function joinRoute(controllerPath: string, handlerPath: string): string {
  const parts = [controllerPath, handlerPath].map((part) => part.replace(/^\/+|\/+$/g, '')).filter((part) => part.length > 0);
  return `/${parts.join('/')}`;
}

function guardNames(handler: Handler, target: ControllerClass): string[] {
  const declared = [
    ...((Reflect.getMetadata(GUARDS_METADATA, target) as unknown[] | undefined) ?? []),
    ...((Reflect.getMetadata(GUARDS_METADATA, handler) as unknown[] | undefined) ?? []),
  ];
  return [...new Set(declared.map((guard) => (typeof guard === 'function' ? guard.name : String(guard))))];
}

function routesOf(target: ControllerClass, file: string): ControllerRoute[] {
  const routes: ControllerRoute[] = [];
  const controllerPaths = asList(Reflect.getMetadata(PATH_METADATA, target));
  const excludedController = Boolean(Reflect.getMetadata(DECORATORS.API_EXCLUDE_CONTROLLER, target)?.[0]);
  for (const name of Object.getOwnPropertyNames(target.prototype)) {
    const handler = target.prototype[name];
    if (name === 'constructor' || typeof handler !== 'function') continue;
    const requestMethod = Reflect.getMetadata(METHOD_METADATA, handler) as RequestMethod | undefined;
    if (requestMethod === undefined) continue;
    const typed = handler as Handler;
    const base = {
      method: RequestMethod[requestMethod],
      controller: target.name,
      handler: name,
      file,
      roles: override<string[]>(ROLES_KEY, typed, target) ?? [],
      internalPermissions: override<string[]>(INTERNAL_PERMISSIONS_KEY, typed, target) ?? [],
      isPublic: override<boolean>(IS_PUBLIC_KEY, typed, target) === true,
      serviceScope: override<unknown>(SERVICE_SCOPE_KEY, typed, target) ?? null,
      signedEventSource: override<string>(SIGNED_EVENT_SOURCE_KEY, typed, target) ?? null,
      guards: guardNames(typed, target),
      excludedFromContract: excludedController || Boolean(Reflect.getMetadata(DECORATORS.API_EXCLUDE_ENDPOINT, typed)?.disable),
    };
    for (const controllerPath of controllerPaths) {
      for (const handlerPath of asList(Reflect.getMetadata(PATH_METADATA, typed))) {
        routes.push({ ...base, path: joinRoute(controllerPath, handlerPath) });
      }
    }
  }
  return routes;
}

/** Todas las rutas que declaran los controladores de `src/`, en orden estable (ruta, método). */
export async function loadControllerRoutes(): Promise<{ routes: ControllerRoute[]; controllers: number }> {
  const routes: ControllerRoute[] = [];
  let controllers = 0;
  for (const file of controllerFiles(resolve(ROOT, 'src'))) {
    const exported = (await import(pathToFileURL(file).href)) as Record<string, unknown>;
    for (const value of Object.values(exported)) {
      if (typeof value !== 'function' || Reflect.getMetadata(PATH_METADATA, value) === undefined) continue;
      controllers += 1;
      routes.push(...routesOf(value as unknown as ControllerClass, relative(ROOT, file).replace(/\\/g, '/')));
    }
  }
  routes.sort((a, b) => a.path.localeCompare(b.path) || a.method.localeCompare(b.method));
  return { routes, controllers };
}

export { routeShape } from './route-shape.js';
