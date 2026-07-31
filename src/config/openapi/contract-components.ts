/**
 * @file Artefacto de soporte específico de esta carpeta.
 * @business Esta pieza permite que un integrador entienda el contrato sin leer el código fuente.
 * @system declara los componentes reutilizables del contrato OpenAPI.
 */
import type { ParameterLike, ReferenceLike, SchemaLike } from './contract-types.js';

/**
 * Componentes reutilizables del contrato de Atlas.
 *
 * Todos describen estructuras que EXISTEN en el código, no un ideal:
 *
 * - El sobre de éxito es literalmente lo que emite `ResponseInterceptor`
 *   (`src/common/interceptors/response.interceptor.ts`).
 * - El sobre de error es literalmente lo que emite `HttpExceptionFilter`
 *   (`src/common/filters/http-exception.filter.ts`), incluidos los `issues` que sólo viajan en 400.
 * - Los códigos de error son los de `buildErrorCode` de ese mismo filtro.
 *
 * Si alguno de esos dos archivos cambia, este también: un contrato que describe un sobre que el
 * backend ya no emite es peor que no tener contrato, porque el integrador confía en él.
 */

/** Códigos de error tal y como los emite `buildErrorCode` del filtro global. */
export const ERROR_CODES = [
  'VALIDATION_ERROR',
  'UNAUTHORIZED',
  'FORBIDDEN',
  'NOT_FOUND',
  'CONFLICT',
  'GONE',
  'PAYLOAD_TOO_LARGE',
  'UNPROCESSABLE_ENTITY',
  'RATE_LIMIT_EXCEEDED',
  'INTERNAL_ERROR',
  'SERVICE_UNAVAILABLE',
] as const;

const requestId: SchemaLike = {
  // Unión de tipos y no `nullable: true`: el contrato se emite como OpenAPI 3.1, donde `nullable`
  // ya no existe y la forma correcta es la de JSON Schema 2020-12.
  type: ['string', 'null'],
  description:
    'Identificador de correlación de la petición. Es el mismo valor del encabezado `x-correlation-id` ' +
    '(lo genera `CorrelationIdMiddleware` si el cliente no lo envía) y el que aparece en los logs, ' +
    'así que es lo que hay que citar al reportar una incidencia.',
  example: '3f9a2c14-9d1e-4a1b-9f0c-6b5d2a7e8c31',
};

const timestamp: SchemaLike = {
  type: 'string',
  format: 'date-time',
  description: 'Momento en que el backend generó la respuesta, en UTC.',
  example: '2026-07-31T13:00:00.000Z',
};

export const VALIDATION_ISSUE_SCHEMA: SchemaLike = {
  type: 'object',
  description: 'Un fallo de validación concreto, tal y como lo reporta el esquema Zod del endpoint.',
  required: ['path', 'message'],
  properties: {
    path: { type: 'string', description: 'Ruta del campo dentro del cuerpo o la query.', example: 'body.email' },
    message: { type: 'string', description: 'Motivo del rechazo.', example: 'Debe contener un correo válido' },
  },
};

export const API_ERROR_SCHEMA: SchemaLike = {
  type: 'object',
  description:
    'Sobre de error uniforme de la API. Lo emite el filtro global para CUALQUIER fallo, así que un ' +
    'cliente puede tratarlo de una sola forma sin importar el endpoint.',
  required: ['error', 'timestamp'],
  properties: {
    requestId,
    error: {
      type: 'object',
      required: ['code', 'message'],
      properties: {
        code: {
          type: 'string',
          enum: [...ERROR_CODES],
          description: 'Código estable y legible por máquina. Es lo que hay que ramificar en el cliente, no el mensaje.',
        },
        message: {
          type: 'string',
          description:
            'Mensaje orientado a personas. En los 5xx está saneado a propósito: la causa real queda en el log ' +
            'del servidor, correlacionada por `requestId`.',
        },
        issues: {
          type: 'array',
          description: 'Sólo en 400: el detalle campo a campo del fallo de validación. Ausente en el resto de errores.',
          // Referencia y no copia: `ValidationIssue` se publica como componente, y duplicar su forma
          // aquí garantizaría que un día las dos definiciones digan cosas distintas.
          items: { $ref: '#/components/schemas/ValidationIssue' },
        },
      },
    },
    timestamp,
  },
};

/**
 * Sobre de éxito. `data` queda sin tipar aquí a propósito: la carga concreta la declara cada
 * operación con su propio `@ApiResponse`. Lo que este componente fija es la ENVOLTURA, que es
 * idéntica en las 263 operaciones y que antes no estaba documentada en ninguna.
 */
export const API_SUCCESS_SCHEMA: SchemaLike = {
  type: 'object',
  description: 'Sobre de éxito uniforme que aplica `ResponseInterceptor` a toda respuesta 2xx.',
  required: ['data', 'timestamp'],
  properties: {
    requestId,
    data: { description: 'Carga útil de la operación. Su forma la declara cada endpoint.' },
    timestamp,
  },
};

/**
 * Forma EXACTA de lo que devuelve `buildPaginationMeta`
 * (`src/common/utils/pagination/pagination.util.ts`), incluido `totalPages`, que faltaba: un
 * componente que declara tres campos cuando el backend emite cuatro es una promesa incumplida en la
 * dirección más fácil de no notar.
 *
 * Viaja dentro de `data`, no en el sobre: `ResponseInterceptor` no añade `meta`. Cada listado la
 * declara en su propia carga y el enriquecido la sustituye por esta referencia cuando la forma
 * coincide campo por campo.
 */
export const PAGINATION_META_SCHEMA: SchemaLike = {
  type: 'object',
  description: 'Metadatos de paginación de los listados que los exponen.',
  required: ['total', 'page', 'limit', 'totalPages'],
  properties: {
    total: { type: 'integer', minimum: 0, description: 'Total de elementos que cumplen el filtro.' },
    page: { type: 'integer', minimum: 1, description: 'Página devuelta, empezando en 1.' },
    limit: { type: 'integer', minimum: 1, description: 'Tamaño de página solicitado.' },
    totalPages: { type: 'integer', minimum: 0, description: 'Número de páginas para ese `limit`.' },
  },
};

/** Encabezados transversales que aplican a toda la API, no a un endpoint concreto. */
export const COMMON_PARAMETERS: Record<string, ParameterLike> = {
  CorrelationId: {
    name: 'x-correlation-id',
    in: 'header',
    required: false,
    description:
      'Identificador de correlación propuesto por el cliente. Si no se envía, el backend genera uno. ' +
      'Viaja a los logs y vuelve en `requestId`, así que enviarlo permite seguir una operación de punta a punta.',
    schema: { type: 'string' },
  },
  IdempotencyKey: {
    name: 'x-idempotency-key',
    in: 'header',
    required: true,
    description:
      'Clave de idempotencia de la mutación. Reintentar con la misma clave devuelve el resultado de la ' +
      'primera ejecución en vez de ejecutar el comando dos veces.',
    schema: { type: 'string' },
  },
  TenantId: {
    name: 'x-tenant-id',
    in: 'header',
    required: true,
    description:
      'Tenant sobre el que se opera. `TenantGuard` lo contrasta contra el `tenantId` del token y responde 403 ' +
      'si no coinciden, así que no es un selector libre.',
    schema: { type: 'string' },
  },
};

/** Respuestas de error reutilizables, referenciadas por las operaciones que pueden producirlas. */
export function buildErrorResponses(): Record<string, { description: string; content: Record<string, { schema: ReferenceLike }> }> {
  const errorContent = { 'application/json': { schema: { $ref: '#/components/schemas/ApiError' } } };
  const responses: Array<[string, string]> = [
    ['BadRequest', 'La solicitud no cumple el esquema de validación. `error.issues` detalla cada campo rechazado.'],
    ['Unauthorized', 'Falta el token de acceso, está expirado, o su emisor/audiencia no son los esperados.'],
    ['Forbidden', 'El actor está autenticado pero no tiene el rol requerido, o el `x-tenant-id` no coincide con su token.'],
    ['NotFound', 'El recurso no existe, o existe en otro tenant (que para este actor es lo mismo).'],
    ['Conflict', 'El estado actual del recurso no admite la operación, o se viola una restricción única.'],
    ['TooManyRequests', 'Se superó el límite de peticiones del endpoint. Reintentar respetando `Retry-After`.'],
    ['InternalError', 'Fallo no controlado. El mensaje viene saneado; la causa está en el log, correlacionada por `requestId`.'],
  ];
  return Object.fromEntries(responses.map(([name, description]) => [name, { description, content: errorContent }]));
}
