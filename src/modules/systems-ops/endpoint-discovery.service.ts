/**
 * @file Servicio de aplicación o dominio: ejecuta reglas y coordina dependencias.
 * @business Esta pieza hace observable y gobernable el propio backend para operaciones, QA y arquitectura.
 * @system descubre endpoints, cataloga impacto de datos, ejecuta pruebas controladas y expone salud y cobertura.
 */
import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { readFile, readdir, stat } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { mapWithConcurrency } from '../../common/utils/concurrency.util.js';
import { env } from '../../config/env.js';
import { buildEndpointCode, moduleFromPath, routeNameFromMethodAndPath } from './endpoint-code.util.js';
import { SystemsCatalogClassifierService } from './systems-catalog-classifier.service.js';
import { OpenApiCatalogService } from './openapi-catalog.service.js';
import { SystemsCatalogRepository } from './systems-catalog.repository.js';
import {
  RoleConstants,
  classDecorators,
  classRoles,
  composedRoleDecorators,
  listConstantsIn,
  methodDecorators,
  resolveRoleConstants,
  roleConstantsFromSources,
  routeRoles,
} from './endpoint-roles.util.js';
import { EndpointSeed } from './systems-ops.types.js';
import { endpointBusinessContext, endpointPayloadSummary } from './endpoint-narrative.util.js';

// `Sse` también declara una ruta HTTP (GET de `text/event-stream`): sin él, el hilo en vivo del soporte no estaba en
// el catálogo, y por tanto tampoco su puerta. `All` responde a cualquier método y se cataloga como tal.
const ROUTE_DECORATOR = /@(Get|Post|Put|Patch|Delete|Options|Head|Sse|All)\(([^)]*)\)([\s\S]*?)(?:\n\s*(?:async\s+)?([A-Za-z0-9_]+)\s*\()/g;
/** `@Sse` es un GET para quien llama; el catálogo guarda el método que viaja por la red, no el decorador. */
const HTTP_METHOD_OF = { SSE: 'GET' } as Readonly<Record<string, string>>;
const CONTROLLER_DECORATOR = /@Controller\(([^)]*)\)[\s\S]*?export\s+class\s+([A-Za-z0-9_]+)\s*\{/g;

export type DiscoveredEndpoint = EndpointSeed & {
  controllerName: string | null;
  handlerName: string | null;
};

function isRoutePublic(classBlock: string, routeIndex: number): boolean {
  const publicMatches = [...classBlock.slice(0, routeIndex).matchAll(/^\s*@Public\(\)/gm)];
  const publicIndex = publicMatches.at(-1)?.index ?? -1;
  if (publicIndex < 0) return false;
  const between = classBlock.slice(publicIndex + '@Public()'.length, routeIndex);
  return !/@(Get|Post|Put|Patch|Delete|Options|Head)\(/.test(between);
}

function decoratorPath(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed || trimmed === '') return '';
  const match = trimmed.match(/['"`]([^'"`]*)['"`]/);
  return match?.[1] ?? '';
}

function joinPaths(...parts: string[]): string {
  const normalized = parts
    .map((part) => part.trim().replace(/^\/+/, '').replace(/\/+$/, ''))
    .filter(Boolean)
    .join('/');
  return `/${normalized}`;
}

@Injectable()
export class EndpointDiscoveryService {
  constructor(
    private readonly repository: SystemsCatalogRepository,
    private readonly classifier: SystemsCatalogClassifierService,
    private readonly openApiCatalog: OpenApiCatalogService,
  ) {}

  /**
   * Descubrir endpoints tiene DOS estrategias y elegir entre ellas es asunto de este servicio, no
   * de quien lo llama: el catálogo desde el contrato OpenAPI —lo que funciona en cualquier
   * despliegue— y el escaneo del código fuente, que sólo alcanza en una máquina de desarrollo.
   */
  async discover(mode: 'OPENAPI_CONTRACT' | 'SOURCE_SCAN', persist: boolean): Promise<{ discovered: number; persisted: number }> {
    if (mode === 'SOURCE_SCAN') return this.discoverAndMaybePersist(persist);
    return this.openApiCatalog.catalogFromContract(persist);
  }

  async discoverAndMaybePersist(
    persist: boolean,
  ): Promise<{ discovered: number; persisted: number; deprecatedCandidates: number; items: DiscoveredEndpoint[] }> {
    const items = await this.scanControllers();
    let persisted = 0;
    if (persist) {
      // Concurrencia acotada (compartida con otros servicios de systems-ops vía
      // `mapWithConcurrency`) en vez de un upsert 100% secuencial: cada `upsertEndpoint` sigue
      // siendo un `ON CONFLICT (method, full_path) DO UPDATE` independiente (sin cambios de
      // semántica), pero se disparan en lotes en paralelo en vez de uno a la vez, para no abrir
      // cientos de conexiones simultáneas contra el pool en un catálogo grande de endpoints.
      await mapWithConcurrency(items, SCAN_CONCURRENCY, (item) => this.repository.upsertEndpoint(item));
      persisted = items.length;
    }
    const activeKeys = new Set(items.map((item) => `${item.method} ${item.fullPath}`));
    const deprecatedCandidates = persist ? await this.repository.markDeprecatedCandidates(activeKeys) : 0;
    return { discovered: items.length, persisted, deprecatedCandidates, items };
  }

  async scanControllers(): Promise<DiscoveredEndpoint[]> {
    const root = join(process.cwd(), 'src', 'modules');
    // Sin código fuente se FALLA, no se devuelve una lista vacía: la imagen no copia `src/modules`,
    // así que en un contenedor esto reportaba `discovered: 0` como un descubrimiento correcto y el
    // operador concluía que su backend no expone endpoints.
    if (!(await pathExists(root))) {
      throw new ServiceUnavailableException(
        'El escaneo de código fuente necesita `src/modules`, que la imagen desplegada no incluye. Usa el modo OPENAPI_CONTRACT, que lee el contrato que este proceso genera de sus propias rutas.',
      );
    }
    const all = await walk(root);
    const files = all.filter((file) => file.endsWith('.controller.ts'));
    // Un `@Roles(...CONSTANTE)` puede usar una lista de cualquier módulo, no sólo de Systems Ops.
    const sources = await mapWithConcurrency(
      all.filter((file) => file.endsWith('.ts') && !file.endsWith('.spec.ts')),
      SCAN_CONCURRENCY,
      (file) => readFile(file, 'utf8'),
    );
    const constants = roleConstantsFromSources(sources);
    // Decoradores compuestos del repo (`applyDecorators(Roles(...))`): Nest los aplica como el `@Roles` que envuelven.
    const composed = composedRoleDecorators(sources, constants);
    const perFile = await mapWithConcurrency(files, SCAN_CONCURRENCY, (file) => this.scanControllerFile(file, constants, composed));
    const seen = new Set<string>();
    return perFile.flat().filter((item) => {
      const key = `${item.method} ${item.fullPath}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  private async scanControllerFile(
    file: string,
    globalConstants: RoleConstants,
    composed: Record<string, string[]>,
  ): Promise<DiscoveredEndpoint[]> {
    const source = await readFile(file, 'utf8');
    const constants = resolveRoleConstants(listConstantsIn(source), globalConstants);
    const controllers = [...source.matchAll(CONTROLLER_DECORATOR)];
    const endpoints: DiscoveredEndpoint[] = [];

    for (const [index, controller] of controllers.entries()) {
      const controllerPath = decoratorPath(controller[1] ?? '');
      const controllerName = controller[2] ?? null;
      const start = controller.index ?? 0;
      const end = controllers[index + 1]?.index ?? source.length;
      const classBlock = source.slice(start, end);
      const fromClass = classRoles(classDecorators(source, start, classBlock), constants, composed);

      for (const route of classBlock.matchAll(ROUTE_DECORATOR)) {
        const decorador = route[1].toUpperCase();
        const method = HTTP_METHOD_OF[decorador] ?? decorador;
        const handlerName = route[4] ?? null;
        const apiPath = joinPaths(env.API_PREFIX, controllerPath, decoratorPath(route[2] ?? ''));
        const riskLevel = this.classifier.riskLevelForEndpoint(method, apiPath);
        const businessContext = endpointBusinessContext(method, apiPath, handlerName);
        const payloadSummary = endpointPayloadSummary(method, apiPath);
        const decorators = `${methodDecorators(classBlock, route.index ?? 0)}
${route[3] ?? ''}`;
        const allowedRoles = routeRoles(decorators, fromClass, constants, composed);
        endpoints.push({
          code: buildEndpointCode(method, apiPath),
          module: moduleFromPath(apiPath),
          method,
          fullPath: apiPath,
          routeName: routeNameFromMethodAndPath(method, apiPath),
          businessPurpose: businessContext.businessPurpose,
          businessAction: handlerName ?? method,
          technicalPurpose: `Controller ${controllerName ?? 'desconocido'} handler ${handlerName ?? 'desconocido'} expone ${method} ${apiPath}.`,
          businessValue: businessContext.businessValue,
          auditStrategy: businessContext.auditStrategy,
          decisionUseCases: businessContext.decisionUseCases,
          inputPayloadContract: payloadSummary.inputPayloadContract,
          outputContract: {
            expectedStatusCodes: [method === 'POST' ? 201 : 200],
            envelope: 'Respuesta HTTP del backend Atlas; revisar OpenAPI para estructura final.',
          },
          payloadOriginSummary: payloadSummary.payloadOriginSummary,
          sideEffectsSummary:
            method === 'GET'
              ? 'Lectura esperada. No debería modificar estado salvo auditoría técnica de acceso.'
              : 'Escritura esperada. Debe registrar cambios de estado, auditoría, eventos internos y entidades impactadas cuando aplique.',
          metadataCompletenessScore: 82,
          expectedStatusCodes: [method === 'POST' ? 201 : 200],
          requiresAuth: !isRoutePublic(classBlock, route.index ?? 0),
          allowedRoles,
          containsPii: this.classifier.containsPiiForEndpoint(apiPath),
          riskLevel,
          isDestructive: method === 'DELETE',
          isReadonly: method === 'GET',
          idempotencyRequired: method !== 'GET' && /decision|start|submit|package|run|retry|cancel|resolve|request/i.test(apiPath),
          requiresStressTest: riskLevel === 'HIGH' || riskLevel === 'CRITICAL',
          requiresIntegrationTest: riskLevel !== 'LOW',
          isTestableFromPortal: false,
          testEnvironmentOnly: true,
          detectedFrom: 'controller',
          confidenceLevel: 'HIGH',
          reviewStatus: 'AUTO_DETECTED',
          sourceFile: relative(process.cwd(), file),
          controllerName,
          handlerName,
        });
      }
    }
    return endpoints;
  }
}

/** Cuántos archivos/endpoints se procesan en paralelo por lote (lecturas de archivo y upserts a la BD). */
const SCAN_CONCURRENCY = 10;

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * Recorre el árbol de directorios con I/O asíncrono — `scanControllers` corre dentro de un
 * handler HTTP (`POST /systems/endpoints/discover`); una versión síncrona (`readdirSync`/
 * `statSync`) bloquearía el event loop completo del proceso Node durante todo el escaneo del
 * árbol `src/modules`, congelando cualquier otro request (incluidos health checks) mientras dura.
 */
async function walk(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(
    entries.map((entry) => {
      const entryPath = join(directory, entry.name);
      return entry.isDirectory() ? walk(entryPath) : Promise.resolve([entryPath]);
    }),
  );
  return files.flat();
}
