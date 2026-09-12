/**
 * @file Servicio de aplicación o dominio: ejecuta reglas y coordina dependencias.
 * @business Esta pieza hace observable y gobernable el propio backend para operaciones, QA y arquitectura.
 * @system cataloga los endpoints de este backend desde su propio contrato OpenAPI, con sus schemas.
 */
import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import type { OpenAPIObject } from '@nestjs/swagger';
import { mapWithConcurrency } from '../../common/utils/concurrency.util.js';
import { buildEndpointCode, moduleFromPath, routeNameFromMethodAndPath } from './endpoint-code.util.js';
import { OpenApiDocumentRegistry } from './openapi-document.registry.js';
import { contractFromRequestBody, contractsFromParameters, contractFromSchema, successStatusCodes } from './openapi-contract.util.js';
import { SystemsCatalogClassifierService } from './systems-catalog-classifier.service.js';
import { SystemsCatalogRepository } from './systems-catalog.repository.js';
import type { EndpointSeed } from './systems-ops.types.js';

const HTTP_METHODS = ['get', 'post', 'put', 'patch', 'delete'] as const;
const UPSERT_CONCURRENCY = 8;

/**
 * Cataloga los endpoints de ESTE backend leyendo el contrato OpenAPI que él mismo genera.
 *
 * El catálogo tenía 18 endpoints de Atlas Backend, sembrados a mano, sobre 333 operaciones reales; y
 * sólo 5 declaraban su contrato de entrada. La consecuencia práctica estaba en el laboratorio de QA
 * del portal: su generador de datos de prueba deriva los valores del contrato publicado, así que
 * para 399 de los 404 endpoints no tenía de dónde derivar y había que escribir el payload a mano —
 * que es exactamente lo que hace que nadie pruebe el caso inválido.
 *
 * Por qué el contrato OpenAPI y no el código:
 *
 * - `endpoint-discovery.service` escanea `src/modules` con expresiones regulares y la imagen de
 *   producción no copia el código fuente. En un contenedor devolvía `discovered: 0` y lo reportaba
 *   como éxito: el botón «descubrir endpoints» del portal no descubría nada, siempre.
 * - Aunque el código estuviera, una regex no puede resolver el `ZodValidationPipe(loginSchema)` de
 *   un decorador hasta los campos de ese esquema. El documento OpenAPI SÍ, porque lo construye
 *   `zodToApiSchema` a partir del esquema real.
 *
 * Lo que se cataloga son los campos y su obligatoriedad, no el validador entero. Ver
 * `openapi-contract.util.ts`.
 */
@Injectable()
export class OpenApiCatalogService {
  private readonly logger = new Logger(OpenApiCatalogService.name);

  constructor(
    private readonly registry: OpenApiDocumentRegistry,
    private readonly repository: SystemsCatalogRepository,
    private readonly classifier: SystemsCatalogClassifierService,
  ) {}

  async catalogFromContract(persist: boolean): Promise<{ discovered: number; persisted: number; withContract: number }> {
    const document = this.registry.get();
    /*
     * Sin documento no se devuelve «cero endpoints»: se falla. Es la lección del escáner de código
     * que sustituye — un catálogo vacío y un catálogo que no se pudo leer piden acciones opuestas, y
     * confundirlos deja al operador creyendo que su backend no expone nada.
     */
    if (!document) {
      throw new ServiceUnavailableException(
        'Este proceso no generó el contrato OpenAPI, así que no hay nada de lo que catalogar. Ocurre en el worker, que no monta rutas HTTP.',
      );
    }

    const seeds = this.buildSeeds(document);
    let persisted = 0;
    if (persist) {
      await mapWithConcurrency(seeds, UPSERT_CONCURRENCY, (seed) => this.repository.upsertEndpoint(seed));
      persisted = seeds.length;
    }
    const withContract = seeds.filter((seed) => Object.keys(seed.minPayloadSchema ?? {}).length > 0).length;
    this.logger.log(`Catálogo desde OpenAPI: ${seeds.length} operaciones, ${withContract} con contrato de entrada.`);
    return { discovered: seeds.length, persisted, withContract };
  }

  buildSeeds(document: OpenAPIObject): EndpointSeed[] {
    const seeds: EndpointSeed[] = [];
    for (const [path, item] of Object.entries(document.paths ?? {})) {
      if (!item || typeof item !== 'object') continue;
      const pathItem = item as Record<string, unknown>;
      for (const method of HTTP_METHODS) {
        const operation = pathItem[method];
        if (!operation || typeof operation !== 'object') continue;
        seeds.push(this.buildSeed(document, method.toUpperCase(), path, operation as Record<string, unknown>, pathItem.parameters));
      }
    }
    return seeds;
  }

  private buildSeed(
    document: OpenAPIObject,
    method: string,
    path: string,
    operation: Record<string, unknown>,
    pathParameters: unknown,
  ): EndpointSeed {
    const body = contractFromRequestBody(document, operation.requestBody);
    const params = contractsFromParameters(document, operation.parameters, pathParameters);
    const statusCodes = successStatusCodes(operation.responses);
    const riskLevel = this.classifier.riskLevelForEndpoint(method, path);
    const summary = typeof operation.summary === 'string' ? operation.summary.trim() : '';
    const description = typeof operation.description === 'string' ? operation.description.trim() : '';
    const isReadonly = method === 'GET';

    return {
      code: buildEndpointCode(method, path),
      module: moduleFromPath(path),
      method,
      fullPath: path,
      routeName: routeNameFromMethodAndPath(method, path),
      businessPurpose: summary || description || `${method} ${path}`,
      businessAction: typeof operation.operationId === 'string' ? operation.operationId : summary || method,
      expectedResponseSummary: description || undefined,
      // Lo declarado, no lo supuesto. El escáner anterior escribía `[201]` para todo POST y `[200]`
      // para el resto: una afirmación inventada sobre el contrato de salida que el laboratorio de QA
      // usaba después como criterio de aprobación.
      expectedStatusCodes: statusCodes,
      minPayloadSchema: body,
      queryParamsSchema: params.query,
      pathParamsSchema: params.path,
      headersSchema: params.headers,
      requiresAuth: this.requiresAuth(operation),
      allowedRoles: [],
      containsPii: this.classifier.containsPiiForEndpoint(path),
      riskLevel,
      isDestructive: method === 'DELETE',
      isReadonly,
      idempotencyRequired: Object.keys(params.headers).some((name) => name.toLowerCase() === 'x-idempotency-key'),
      requiresStressTest: riskLevel === 'HIGH' || riskLevel === 'CRITICAL',
      requiresIntegrationTest: riskLevel !== 'LOW',
      // Éstos SÍ son probables desde el portal: son rutas de este mismo backend, que es el host que
      // el ejecutor de pruebas tiene permitido. Es la diferencia con los endpoints federados.
      isTestableFromPortal: true,
      testEnvironmentOnly: !isReadonly,
      detectedFrom: 'openapi_contract',
      confidenceLevel: 'HIGH',
      reviewStatus: 'AUTO_DETECTED',
      inputPayloadContract: {
        body,
        query: params.query,
        path: params.path,
        headers: params.headers,
      },
      outputContract: {
        expectedStatusCodes: statusCodes,
        envelope: 'Sobre estándar de Atlas: { requestId, data, timestamp } en éxito; { requestId, error, timestamp } en fallo.',
      },
      sideEffectsSummary: isReadonly
        ? 'Lectura. No modifica estado de negocio; queda registrada en la auditoría de accesos.'
        : 'Escritura. Debe registrar el cambio de estado y las entidades impactadas en la auditoría.',
    };
  }

  /**
   * Un endpoint es público cuando el contrato declara `security: []` — que es lo que emite
   * `@Public()` — y no cuando simplemente no dice nada: sin declaración local rige la seguridad
   * global del documento, que en este backend es el bearer.
   */
  private requiresAuth(operation: Record<string, unknown>): boolean {
    const security = operation.security;
    if (!Array.isArray(security)) return true;
    return security.length > 0;
  }

  /** El contrato de salida para una operación concreta, sin catalogar. Lo usa el detalle de endpoint. */
  responseContract(document: OpenAPIObject, responses: unknown): Record<string, unknown> {
    if (!responses || typeof responses !== 'object') return {};
    const ok = (responses as Record<string, unknown>)['200'] ?? (responses as Record<string, unknown>)['201'];
    if (!ok || typeof ok !== 'object') return {};
    const content = (ok as Record<string, unknown>).content;
    if (!content || typeof content !== 'object') return {};
    const json = (content as Record<string, unknown>)['application/json'];
    if (!json || typeof json !== 'object') return {};
    return contractFromSchema(document, (json as Record<string, unknown>).schema);
  }
}
