/**
 * @file Artefacto de soporte específico de esta carpeta.
 * @business Esta pieza permite que un integrador entienda el contrato sin leer el código fuente.
 * @system completa el documento OpenAPI generado por Nest con lo que es transversal a toda la API.
 */
import {
  isReference,
  type OpenApiLike,
  type OperationLike,
  type ParameterLike,
  type ResponseLike,
  type SchemaLike,
} from './contract-types.js';
import {
  API_ERROR_SCHEMA,
  API_SUCCESS_SCHEMA,
  COMMON_PARAMETERS,
  PAGINATION_META_SCHEMA,
  VALIDATION_ISSUE_SCHEMA,
  buildErrorResponses,
} from './contract-components.js';
import { describeParameters, normalizeDocument, shareCommonHeaderParameters } from './normalize-contract.js';

const HTTP_METHODS = ['get', 'post', 'put', 'patch', 'delete', 'head', 'options'] as const;
type HttpMethod = (typeof HTTP_METHODS)[number];

/**
 * Completa el documento que genera `SwaggerModule.createDocument` con lo que Nest no puede saber.
 *
 * El generador deriva el contrato de los decoradores, y los decoradores describen cada endpoint por
 * separado. Lo que NO describen es lo transversal: que toda respuesta 2xx viaja dentro del sobre de
 * `ResponseInterceptor`, que todo error sale con la forma de `HttpExceptionFilter`, que el throttler
 * global puede responder 429 en cualquier ruta y que casi todas exigen bearer token.
 *
 * Medido sobre el contrato generado ANTES de este paso: **252 de 263 respuestas 2xx no declaraban
 * ningún esquema** y `components.schemas` estaba vacío. Un integrador no podía saber qué recibiría
 * sin llamar al endpoint y mirar el resultado.
 *
 * La alternativa era anotar a mano las 263 operaciones en 46 controllers. Se descartó no por
 * esfuerzo, sino porque el sobre es UNO: repetirlo 263 veces garantiza que en la 264ª alguien lo
 * olvide, y que al cambiarlo queden 263 sitios desincronizados.
 *
 * Lo que este paso NO hace: inventar el tipo de `data`. Esa parte la declara cada endpoint con su
 * `@ApiResponse`; aquí sólo se fija la envoltura, que es verificable leyendo el interceptor.
 */
export function enrichOpenApiDocument<T extends object>(document: T): T {
  const target = document as unknown as OpenApiLike;
  registerComponents(target);

  for (const [path, pathItem] of Object.entries(target.paths ?? {})) {
    for (const method of HTTP_METHODS) {
      const operation = pathItem[method];
      if (!operation) continue;
      normalizePublicSecurity(operation);
      ensurePathParametersDeclared(path, operation);
      // El orden importa: primero se comparten los encabezados transversales (los que quedan inline
      // heredan la descripción del componente) y sólo después se rellena lo que siga sin describir.
      shareCommonHeaderParameters(operation);
      describeParameters(operation);
      applyEnvelopeToSuccessResponses(operation);
      applyStandardErrorResponses(operation, method);
    }
  }

  // Al final: las normalizaciones de documento completo recorren también lo que este paso acaba de
  // insertar (envolturas, respuestas de error y parámetros compartidos).
  normalizeDocument(target);

  return document;
}

function registerComponents(document: OpenApiLike): void {
  document.components ??= {};
  document.components.schemas = {
    ...(document.components.schemas ?? {}),
    ApiError: API_ERROR_SCHEMA,
    ApiSuccess: API_SUCCESS_SCHEMA,
    ValidationIssue: VALIDATION_ISSUE_SCHEMA,
    PaginationMeta: PAGINATION_META_SCHEMA,
  };
  document.components.responses = { ...(document.components.responses ?? {}), ...buildErrorResponses() };
  document.components.parameters = { ...(document.components.parameters ?? {}), ...COMMON_PARAMETERS };
}

/**
 * Traduce la marca de "endpoint público" a la forma que define el estándar.
 *
 * `@Public()` aplica `ApiSecurity('')`, que es la única manera que ofrece Nest de marcar una
 * operación sin esquema de seguridad. Lo que emite es `security: [{ '': [] }]`: una referencia a un
 * esquema llamado cadena vacía, que no existe en `components.securitySchemes`. Un validador lo
 * rechaza con razón, y una herramienta que lo lea intentará resolver un esquema inexistente.
 *
 * La forma correcta en OpenAPI para "esta operación NO requiere autenticación" es el array **vacío**:
 * `security: []`. Se normaliza aquí, y no cambiando el decorador, porque el decorador tiene que
 * seguir haciendo su trabajo principal —marcar el metadato que lee `JwtAuthGuard`— y `ApiSecurity('')`
 * es el gancho que Nest ofrece para acompañarlo.
 */
function normalizePublicSecurity(operation: OperationLike): void {
  if (!Array.isArray(operation.security)) return;
  const marksPublic = operation.security.some((requirement) => Object.prototype.hasOwnProperty.call(requirement, ''));
  if (marksPublic) operation.security = [];
}

/**
 * Declara los parámetros de ruta que la plantilla exige y la operación no menciona.
 *
 * Origen del problema: un handler que valida con `@Param(new ZodValidationPipe(schema))` —sin nombre
 * de parámetro— recibe el objeto completo, y Nest no puede inferir de ahí qué segmentos son
 * variables. El contrato salía con rutas como `/customer-onboarding/{customerId}/reference-contacts/{referenceId}`
 * cuya operación no declaraba ninguno de los dos: un generador de cliente producía un método sin
 * argumentos y una URL literal con llaves.
 *
 * La plantilla de la ruta es la autoridad: si el path dice `{referenceId}`, ese parámetro existe, es
 * de tipo `path` y es obligatorio. No hay nada que suponer. Se completa aquí y no endpoint por
 * endpoint porque es una propiedad de la RUTA, no de cada handler, y porque así queda cubierto
 * también el próximo endpoint que se escriba con el mismo patrón.
 *
 * Lo que sí queda fuera: el TIPO real del parámetro y su descripción. Un endpoint que quiera
 * declararlos con `@ApiParam` gana, porque nunca se pisa uno ya declarado.
 */
function ensurePathParametersDeclared(path: string, operation: OperationLike): void {
  const templated = [...path.matchAll(/\{([^}]+)\}/g)].map((match) => match[1]).filter((name): name is string => Boolean(name));
  if (templated.length === 0) return;

  operation.parameters ??= [];
  const declared = new Set(
    operation.parameters
      .filter((parameter): parameter is ParameterLike => !isReference(parameter))
      .filter((parameter) => parameter.in === 'path')
      .map((parameter) => parameter.name),
  );

  for (const name of templated) {
    if (declared.has(name)) continue;
    operation.parameters.push({
      name,
      in: 'path',
      required: true,
      description: `Identificador de ruta \`${name}\`.`,
      schema: { type: 'string' },
    });
  }
}

/**
 * Toda respuesta 2xx viaja dentro del sobre. Si la operación ya declaró el tipo de su carga, se
 * conserva y se envuelve en `data`; si no declaró nada, al menos queda documentada la envoltura.
 */
function applyEnvelopeToSuccessResponses(operation: OperationLike): void {
  for (const [statusCode, response] of Object.entries(operation.responses ?? {})) {
    if (!statusCode.startsWith('2')) continue;
    // 204 No Content no lleva cuerpo: envolverlo documentaría algo que no se emite.
    if (statusCode === '204') continue;
    if (isReference(response)) continue;

    const target = response as ResponseLike;
    const declaredPayload = target.content?.['application/json']?.schema;
    const envelope: SchemaLike = declaredPayload
      ? { allOf: [{ $ref: '#/components/schemas/ApiSuccess' }, { type: 'object', properties: { data: declaredPayload } }] }
      : { $ref: '#/components/schemas/ApiSuccess' };

    target.content = { 'application/json': { schema: envelope } };
  }
}

/**
 * Añade las respuestas de error que el endpoint PUEDE producir aunque su decorador no las declare.
 *
 * El criterio es conservador: sólo se añade lo que se deduce de hechos comprobables del propio
 * documento, nunca de una suposición sobre el handler.
 *
 *  - 429 y 500 en todas: el throttler es global y el filtro global captura cualquier excepción.
 *  - 401 y 403 sólo donde la operación declara seguridad. Los endpoints `@Public()` salen del
 *    generador sin `security`, así que su ausencia es la señal fiable de que no autentican.
 *  - 400 donde hay algo que validar (cuerpo o parámetros).
 *  - 404 en las operaciones con parámetro de ruta: sin `:id` no hay un recurso concreto que falte.
 *  - 409 en las mutaciones, que es donde puede saltar una restricción única o un estado incompatible.
 *
 * Nunca se pisa una respuesta ya declarada por el controller: si alguien documentó su propio 404 con
 * una descripción específica, esa gana.
 */
function applyStandardErrorResponses(operation: OperationLike, method: HttpMethod): void {
  operation.responses ??= {};

  const authenticated = Array.isArray(operation.security) && operation.security.length > 0;
  const hasInput = Boolean(operation.requestBody) || (operation.parameters?.length ?? 0) > 0;
  const hasPathParameter = (operation.parameters ?? []).some(
    (parameter) => !isReference(parameter) && (parameter as ParameterLike).in === 'path',
  );
  const mutating = method === 'post' || method === 'put' || method === 'patch' || method === 'delete';

  const applicable: Array<[string, string]> = [
    ['429', 'TooManyRequests'],
    ['500', 'InternalError'],
  ];
  if (hasInput) applicable.unshift(['400', 'BadRequest']);
  if (authenticated) applicable.unshift(['401', 'Unauthorized'], ['403', 'Forbidden']);
  if (hasPathParameter) applicable.unshift(['404', 'NotFound']);
  if (mutating) applicable.unshift(['409', 'Conflict']);

  for (const [statusCode, componentName] of applicable) {
    if (operation.responses[statusCode]) continue;
    operation.responses[statusCode] = { $ref: `#/components/responses/${componentName}` };
  }
}
