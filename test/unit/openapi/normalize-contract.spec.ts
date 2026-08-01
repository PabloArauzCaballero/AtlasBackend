import { describe, expect, it } from '@jest/globals';
import {
  describeParameters,
  ensureCorrelationIdParameter,
  normalizeDocument,
  normalizeNullableToUnionTypes,
  shareCommonHeaderParameters,
  sharePaginationMeta,
} from '../../../src/config/openapi/normalize-contract.js';
import type { OpenApiLike, OperationLike } from '../../../src/config/openapi/contract-types.js';

/**
 * Estas transformaciones son las que deciden qué recibe un integrador. Un fallo aquí no rompe
 * ningún test de negocio: produce un contrato que describe algo que el backend no hace, que es peor
 * que no publicarlo. Por eso se prueban por comportamiento observable sobre documentos mínimos.
 */

describe('normalizeNullableToUnionTypes', () => {
  it('traduce `nullable: true` a la unión de tipos de OpenAPI 3.1', () => {
    const schema = { type: 'string', nullable: true };

    normalizeNullableToUnionTypes(schema);

    expect(schema).toEqual({ type: ['string', 'null'] });
  });

  it('elimina `nullable: false` sin tocar el tipo: en 3.1 no aporta nada', () => {
    const schema = { type: 'integer', nullable: false };

    normalizeNullableToUnionTypes(schema);

    expect(schema).toEqual({ type: 'integer' });
  });

  it('no duplica `null` en un tipo que ya lo declara', () => {
    const schema = { type: ['string', 'null'], nullable: true };

    normalizeNullableToUnionTypes(schema);

    expect(schema).toEqual({ type: ['string', 'null'] });
  });

  it('permite null explícitamente cuando el esquema no declara tipo', () => {
    const schema = { allOf: [{ $ref: '#/components/schemas/Algo' }], nullable: true };

    normalizeNullableToUnionTypes(schema);

    expect(schema).toEqual({ allOf: [{ $ref: '#/components/schemas/Algo' }], type: ['null'] });
  });

  it('recorre esquemas anidados y arreglos', () => {
    const document = {
      paths: {
        '/x': {
          get: {
            responses: {
              200: { content: { 'application/json': { schema: { properties: { a: { type: 'string', nullable: true } } } } } },
            },
          },
        },
      },
      items: [{ type: 'number', nullable: true }],
    };

    normalizeNullableToUnionTypes(document);

    const nested = document.paths['/x'].get.responses[200].content['application/json'].schema.properties.a;
    expect(nested).toEqual({ type: ['string', 'null'] });
    expect(document.items[0]).toEqual({ type: ['number', 'null'] });
  });
});

describe('shareCommonHeaderParameters', () => {
  it('sustituye por referencia el encabezado cuya obligatoriedad coincide con el componente', () => {
    const operation: OperationLike = {
      parameters: [{ name: 'x-tenant-id', in: 'header', required: true, schema: { type: 'string' } }],
    };

    shareCommonHeaderParameters(operation);

    expect(operation.parameters).toEqual([{ $ref: '#/components/parameters/TenantId' }]);
  });

  it('conserva la declaración inline cuando el endpoint lo hace opcional, y le copia la descripción', () => {
    // Hay endpoints donde `x-tenant-id` es opcional porque se deduce del token: un `$ref` no puede
    // matizar `required`, así que sustituirlo mentiría sobre el contrato.
    const operation: OperationLike = {
      parameters: [{ name: 'x-tenant-id', in: 'header', required: false, schema: { type: 'string' } }],
    };

    shareCommonHeaderParameters(operation);

    const [parameter] = operation.parameters ?? [];
    expect(parameter).toMatchObject({ name: 'x-tenant-id', required: false });
    expect((parameter as { description?: string }).description).toContain('TenantGuard');
  });

  it('no toca parámetros que no son encabezados transversales', () => {
    const operation: OperationLike = {
      parameters: [
        { name: 'customerId', in: 'path', required: true },
        { name: 'x-otro', in: 'header', required: true },
      ],
    };
    const before = JSON.parse(JSON.stringify(operation.parameters));

    shareCommonHeaderParameters(operation);

    expect(operation.parameters).toEqual(before);
  });

  it('es tolerante a una operación sin parámetros', () => {
    const operation: OperationLike = {};
    expect(() => shareCommonHeaderParameters(operation)).not.toThrow();
  });
});

describe('ensureCorrelationIdParameter', () => {
  it('añade la referencia al encabezado de correlación cuando no está declarado', () => {
    const operation: OperationLike = {};

    ensureCorrelationIdParameter(operation);

    expect(operation.parameters).toEqual([{ $ref: '#/components/parameters/CorrelationId' }]);
  });

  it('no lo duplica si ya está como referencia', () => {
    const operation: OperationLike = { parameters: [{ $ref: '#/components/parameters/CorrelationId' }] };

    ensureCorrelationIdParameter(operation);

    expect(operation.parameters).toHaveLength(1);
  });

  it('no lo duplica si el controller ya lo declaró inline, sin importar mayúsculas', () => {
    const operation: OperationLike = { parameters: [{ name: 'X-Correlation-Id', in: 'header' }] };

    ensureCorrelationIdParameter(operation);

    expect(operation.parameters).toHaveLength(1);
  });
});

describe('describeParameters', () => {
  it('describe los parámetros catalogados por nombre y ubicación', () => {
    const operation: OperationLike = {
      parameters: [
        { name: 'page', in: 'query' },
        { name: 'customerId', in: 'path' },
      ],
    };

    describeParameters(operation);

    expect((operation.parameters?.[0] as { description?: string }).description).toContain('Página solicitada');
    expect((operation.parameters?.[1] as { description?: string }).description).toContain('cliente');
  });

  it('nunca pisa una descripción escrita por el endpoint', () => {
    const operation: OperationLike = { parameters: [{ name: 'page', in: 'query', description: 'Página del listado de casos.' }] };

    describeParameters(operation);

    expect((operation.parameters?.[0] as { description?: string }).description).toBe('Página del listado de casos.');
  });

  it('describe cualquier parámetro de ruta aunque no esté catalogado: la plantilla lo declara como identificador', () => {
    const operation: OperationLike = { parameters: [{ name: 'algoNuevoId', in: 'path' }] };

    describeParameters(operation);

    expect((operation.parameters?.[0] as { description?: string }).description).toContain('algoNuevoId');
  });

  it('deja sin describir un query no catalogado, para que el linter lo siga reportando', () => {
    const operation: OperationLike = { parameters: [{ name: 'filtroExotico', in: 'query' }] };

    describeParameters(operation);

    expect((operation.parameters?.[0] as { description?: string }).description).toBeUndefined();
  });
});

describe('sharePaginationMeta', () => {
  it('referencia el componente cuando la forma coincide campo por campo', () => {
    const node = {
      properties: {
        meta: {
          type: 'object',
          properties: { total: {}, page: {}, limit: {}, totalPages: {} },
        },
      },
    };

    sharePaginationMeta(node);

    expect(node.properties.meta).toEqual({ $ref: '#/components/schemas/PaginationMeta' });
  });

  it('deja intacto un `meta` con otra forma: mismo nombre no es el mismo contrato', () => {
    const node = { properties: { meta: { type: 'object', properties: { total: {}, cursor: {} } } } };
    const before = JSON.parse(JSON.stringify(node.properties.meta));

    sharePaginationMeta(node);

    expect(node.properties.meta).toEqual(before);
  });

  it('no vuelve a tocar un `meta` que ya es una referencia', () => {
    const node = { properties: { meta: { $ref: '#/components/schemas/PaginationMeta' } } };

    sharePaginationMeta(node);

    expect(node.properties.meta).toEqual({ $ref: '#/components/schemas/PaginationMeta' });
  });
});

describe('normalizeDocument', () => {
  it('aplica las normalizaciones tanto a paths como a components', () => {
    const document: OpenApiLike = {
      paths: { '/x': { get: { responses: { 200: { content: { 'application/json': { schema: { type: 'string', nullable: true } } } } } } } },
      components: { schemas: { Algo: { type: 'object', properties: { a: { type: 'string', nullable: true } } } } },
    };

    normalizeDocument(document);

    const path = document.paths?.['/x']?.get?.responses?.['200'] as { content: { 'application/json': { schema: { type: string[] } } } };
    expect(path.content['application/json'].schema.type).toEqual(['string', 'null']);
    const component = document.components?.schemas?.Algo as { properties: { a: { type: string[] } } };
    expect(component.properties.a.type).toEqual(['string', 'null']);
  });
});
