/**
 * @file Artefacto de soporte específico de esta carpeta.
 * @business Esta pieza permite que un integrador entienda el contrato sin leer el código fuente.
 * @system declara la forma mínima del documento OpenAPI que este proyecto manipula.
 */

/**
 * Tipos estructurales del documento OpenAPI.
 *
 * `@nestjs/swagger` publica sus interfaces de especificación bajo `dist/interfaces/`, pero su mapa
 * `exports` en package.json no expone esa ruta: importarla falla en tiempo de compilación. Se
 * declara aquí la porción que este proyecto realmente toca, que además deja explícito el subconjunto
 * del estándar del que dependemos: si mañana se cambia de generador, esto es el contrato a cumplir.
 */

export type SchemaLike = Record<string, unknown>;

export type ReferenceLike = { $ref: string };

export type MediaTypeLike = { schema?: SchemaLike | ReferenceLike };

export type ResponseLike = {
  description?: string;
  content?: Record<string, MediaTypeLike>;
};

export type ParameterLike = {
  name?: string;
  in?: string;
  required?: boolean;
  description?: string;
  schema?: SchemaLike;
};

export type OperationLike = {
  operationId?: string;
  summary?: string;
  description?: string;
  tags?: string[];
  security?: Array<Record<string, string[]>>;
  parameters?: Array<ParameterLike | ReferenceLike>;
  requestBody?: unknown;
  responses?: Record<string, ResponseLike | ReferenceLike>;
};

export type PathItemLike = Record<string, OperationLike | undefined>;

export type OpenApiLike = {
  openapi?: string;
  info?: Record<string, unknown>;
  paths?: Record<string, PathItemLike>;
  components?: {
    schemas?: Record<string, SchemaLike>;
    responses?: Record<string, ResponseLike>;
    parameters?: Record<string, ParameterLike>;
    [key: string]: unknown;
  };
  [key: string]: unknown;
};

export function isReference(value: ResponseLike | ReferenceLike | ParameterLike): value is ReferenceLike {
  return typeof value === 'object' && value !== null && '$ref' in value;
}
