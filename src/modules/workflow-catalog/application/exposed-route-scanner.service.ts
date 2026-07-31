/**
 * @file Servicio de aplicación o dominio: ejecuta reglas y coordina dependencias.
 * @business Esta pieza publica el árbol de endpoints del proceso estándar para que cliente y portal no dupliquen su lógica.
 * @system expone el catálogo versionado de flujos, etapas, pasos, dependencias y transiciones.
 */
import { Injectable, RequestMethod } from '@nestjs/common';
import { DiscoveryService, MetadataScanner, Reflector } from '@nestjs/core';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants.js';
import { IS_PUBLIC_KEY } from '../../../common/decorators/public.decorator.js';
import { ROLES_KEY } from '../../../common/decorators/roles.decorator.js';

export type ExposedRoute = {
  method: string;
  routePath: string;
  controllerName: string;
  handlerName: string;
  roles: string[];
  isPublic: boolean;
};

const METHOD_NAMES: Readonly<Record<number, string>> = {
  [RequestMethod.GET]: 'GET',
  [RequestMethod.POST]: 'POST',
  [RequestMethod.PUT]: 'PUT',
  [RequestMethod.DELETE]: 'DELETE',
  [RequestMethod.PATCH]: 'PATCH',
  [RequestMethod.OPTIONS]: 'OPTIONS',
  [RequestMethod.HEAD]: 'HEAD',
  [RequestMethod.ALL]: 'ALL',
};

/**
 * Inventario de las rutas que la aplicación EXPONE de verdad, leído del contenedor de Nest.
 *
 * Es deliberadamente distinto de `EndpointDiscoveryService` (systems-ops), que analiza los archivos
 * fuente con expresiones regulares: eso responde "qué hay escrito en el repositorio", y aquí hace
 * falta "qué quedó montado en ESTE proceso". Un controlador que existe en `src/` pero cuyo módulo
 * nadie importó no atiende ninguna petición — y es justo el tipo de divergencia que el informe de
 * consistencia tiene que detectar, no heredar.
 *
 * Se apoya en `DiscoveryService` y en los metadatos de los decoradores, no en el router interno de
 * Express: esa estructura es un detalle de implementación del adaptador HTTP que cambia entre
 * versiones mayores, mientras que `PATH_METADATA`/`METHOD_METADATA` son el contrato público de Nest.
 */
@Injectable()
export class ExposedRouteScannerService {
  constructor(
    private readonly discoveryService: DiscoveryService,
    private readonly metadataScanner: MetadataScanner,
    private readonly reflector: Reflector,
  ) {}

  scan(): ExposedRoute[] {
    const routes: ExposedRoute[] = [];

    for (const wrapper of this.discoveryService.getControllers()) {
      const metatype = wrapper.metatype;
      if (!metatype || !wrapper.instance) continue;

      const basePath = normalizeSegment(Reflect.getMetadata(PATH_METADATA, metatype) as string | string[] | undefined);
      const classRoles = (Reflect.getMetadata(ROLES_KEY, metatype) as string[] | undefined) ?? [];
      const classPublic = Reflect.getMetadata(IS_PUBLIC_KEY, metatype) === true;
      const prototype = Object.getPrototypeOf(wrapper.instance) as object;

      for (const handlerName of this.metadataScanner.getAllMethodNames(prototype)) {
        const handler = (prototype as Record<string, unknown>)[handlerName];
        if (typeof handler !== 'function') continue;

        const methodMetadata = Reflect.getMetadata(METHOD_METADATA, handler) as number | undefined;
        if (methodMetadata === undefined) continue;

        const handlerPath = normalizeSegment(Reflect.getMetadata(PATH_METADATA, handler) as string | string[] | undefined);
        const handlerRoles = this.reflector.get<string[]>(ROLES_KEY, handler) ?? classRoles;
        const isPublic = this.reflector.get<boolean>(IS_PUBLIC_KEY, handler) === true || classPublic;

        routes.push({
          method: METHOD_NAMES[methodMetadata] ?? 'ALL',
          routePath: joinPath(basePath, handlerPath),
          controllerName: metatype.name,
          handlerName,
          roles: [...handlerRoles],
          isPublic,
        });
      }
    }

    return routes.sort((a, b) => `${a.routePath} ${a.method}`.localeCompare(`${b.routePath} ${b.method}`));
  }
}

/** Un `@Controller([...])`/`@Get([...])` con varias rutas se resuelve por la primera, igual que Nest. */
function normalizeSegment(value: string | string[] | undefined): string {
  const raw = Array.isArray(value) ? (value[0] ?? '') : (value ?? '');
  return raw.replace(/^\/+/, '').replace(/\/+$/, '');
}

function joinPath(...segments: string[]): string {
  const joined = segments.filter((segment) => segment !== '').join('/');
  return `/${joined}`;
}
