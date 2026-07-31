/**
 * @file Artefacto de soporte específico de esta carpeta.
 * @business Esta pieza permite que un integrador entienda el contrato sin leer el código fuente.
 * @system normaliza el documento generado a OpenAPI 3.1 y reutiliza sus componentes comunes.
 */
import { isReference, type OpenApiLike, type OperationLike, type ParameterLike, type SchemaLike } from './contract-types.js';
import { COMMON_PARAMETERS } from './contract-components.js';
import { parameterDescriptionFor } from './contract-parameters.js';

/** Nombre del encabezado -> componente reutilizable que lo describe. */
const HEADER_COMPONENTS: Readonly<Record<string, string>> = {
  'x-correlation-id': 'CorrelationId',
  'x-idempotency-key': 'IdempotencyKey',
  'x-tenant-id': 'TenantId',
};

/**
 * Convierte `nullable: true` a la forma de OpenAPI 3.1.
 *
 * El documento declara `openapi: 3.1.0`, pero el generador de esquemas emite `nullable: true`, que es
 * sintaxis de 3.0 y **no existe** en 3.1: allí el estándar es JSON Schema 2020-12, donde la nulidad
 * se expresa uniendo el tipo con `null`. Un validador estricto lo reporta como propiedad inesperada
 * (52 casos en el contrato) y una herramienta que genere clientes tratará el campo como no nulable,
 * que es justo el error que rompe en producción.
 *
 * Se normaliza al publicar y no en cada esquema Zod porque el origen es el conversor, no el dominio:
 * cualquier esquema nuevo heredaría el mismo defecto.
 */
export function normalizeNullableToUnionTypes(node: unknown): void {
  if (Array.isArray(node)) {
    for (const item of node) normalizeNullableToUnionTypes(item);
    return;
  }
  if (typeof node !== 'object' || node === null) return;

  const schema = node as SchemaLike;
  if (schema.nullable === true) {
    delete schema.nullable;
    const declared = schema.type;
    if (typeof declared === 'string') schema.type = [declared, 'null'];
    else if (Array.isArray(declared)) {
      if (!declared.includes('null')) schema.type = [...declared, 'null'];
    } else {
      // Sin `type` declarado (p. ej. sólo `allOf`/`$ref`), la única traducción fiel es permitir null
      // explícitamente junto a lo que ya hubiera.
      schema.type = ['null'];
    }
  } else if (schema.nullable === false) {
    delete schema.nullable;
  }

  for (const value of Object.values(schema)) normalizeNullableToUnionTypes(value);
}

/**
 * Sustituye los encabezados transversales declarados inline por una referencia al componente.
 *
 * `@ApiHeader({ name: 'x-tenant-id' })` repetido en 122 operaciones produce 122 declaraciones sin
 * descripción. El componente ya la tiene escrita una vez y bien.
 *
 * La referencia sólo se aplica cuando la obligatoriedad coincide con la del componente: hay endpoints
 * donde `x-tenant-id` es opcional porque se deduce del token, y un `$ref` no puede matizar `required`.
 * En esos casos se conserva la declaración inline y se le copia la descripción, que es lo que
 * realmente faltaba.
 */
export function shareCommonHeaderParameters(operation: OperationLike): void {
  if (!operation.parameters) return;

  operation.parameters = operation.parameters.map((parameter) => {
    if (isReference(parameter)) return parameter;
    const inline = parameter as ParameterLike;
    if (inline.in !== 'header' || !inline.name) return parameter;

    const componentName = HEADER_COMPONENTS[inline.name.toLowerCase()];
    if (!componentName) return parameter;

    const component = COMMON_PARAMETERS[componentName];
    const sameRequirement = Boolean(inline.required) === Boolean(component?.required);
    if (sameRequirement) return { $ref: `#/components/parameters/${componentName}` };

    inline.description ??= component?.description;
    return inline;
  });
}

/**
 * Rellena la descripción de los parámetros que no la traen, con texto curado por nombre.
 *
 * Nunca pisa una descripción existente: si un endpoint se molestó en explicar su parámetro, ese
 * texto es más específico que cualquier genérico.
 */
export function describeParameters(operation: OperationLike): void {
  for (const parameter of operation.parameters ?? []) {
    if (isReference(parameter)) continue;
    const target = parameter as ParameterLike;
    if (target.description) continue;
    const description = parameterDescriptionFor(target.in, target.name);
    if (description) target.description = description;
  }
}

/**
 * Referencia el componente de paginación allí donde la carga expone exactamente su forma.
 *
 * El sobre de respuesta NO lleva `meta` (ver `ResponseInterceptor`): la paginación viaja dentro de
 * `data`, declarada por cada listado. Cuando esa estructura coincide campo por campo con el
 * componente, se sustituye por la referencia; si difiere, se deja como está, porque entonces no es
 * el mismo contrato aunque se llame igual.
 */
export function sharePaginationMeta(node: unknown): void {
  if (Array.isArray(node)) {
    for (const item of node) sharePaginationMeta(item);
    return;
  }
  if (typeof node !== 'object' || node === null) return;

  const schema = node as SchemaLike;
  const properties = schema.properties;
  if (properties && typeof properties === 'object') {
    const bag = properties as Record<string, unknown>;
    if (matchesPaginationMeta(bag.meta)) bag.meta = { $ref: '#/components/schemas/PaginationMeta' };
  }

  for (const value of Object.values(schema)) sharePaginationMeta(value);
}

const PAGINATION_FIELDS = ['limit', 'page', 'total', 'totalPages'];

function matchesPaginationMeta(candidate: unknown): boolean {
  if (typeof candidate !== 'object' || candidate === null || '$ref' in (candidate as object)) return false;
  const properties = (candidate as SchemaLike).properties;
  if (typeof properties !== 'object' || properties === null) return false;
  const keys = Object.keys(properties as Record<string, unknown>).sort();
  return keys.length === PAGINATION_FIELDS.length && keys.every((key, index) => key === PAGINATION_FIELDS[index]);
}

/** Aplica al documento completo las normalizaciones que no dependen de una operación concreta. */
export function normalizeDocument(document: OpenApiLike): void {
  normalizeNullableToUnionTypes(document.paths ?? {});
  normalizeNullableToUnionTypes(document.components ?? {});
  sharePaginationMeta(document.paths ?? {});
}
