import type { OpenAPIObject } from '@nestjs/swagger';
import {
  contractFromRequestBody,
  contractFromSchema,
  contractsFromParameters,
  successStatusCodes,
} from '../../../src/modules/systems-ops/openapi-contract.util.js';

/**
 * El catálogo guarda el contrato en su formato abreviado `{ campo: 'tipo|required' }`, que es el que
 * lee el generador de datos de prueba del portal. Estas pruebas fijan esa traducción: si se rompe,
 * el laboratorio de QA vuelve a quedarse sin campos de los que derivar valores.
 */

function documentWith(components: Record<string, unknown> = {}): OpenAPIObject {
  return { openapi: '3.1.0', info: { title: 't', version: '1' }, paths: {}, components: { schemas: components } } as OpenAPIObject;
}

describe('contractFromSchema', () => {
  it('traduce propiedades y obligatoriedad al formato abreviado', () => {
    const contract = contractFromSchema(documentWith(), {
      type: 'object',
      properties: { email: { type: 'string' }, edad: { type: 'integer' }, activo: { type: 'boolean' } },
      required: ['email'],
    });

    expect(contract).toEqual({
      email: 'string|required',
      edad: 'integer|optional',
      activo: 'boolean|optional',
    });
  });

  /** Nest compone la herencia de DTOs con `allOf`. Sin aplanarlo, el cuerpo se cataloga sin campos. */
  it('aplana `allOf` y conserva los obligatorios de cada rama', () => {
    const document = documentWith({
      Base: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
    });

    const contract = contractFromSchema(document, {
      allOf: [{ $ref: '#/components/schemas/Base' }, { type: 'object', properties: { nota: { type: 'string' } } }],
    });

    expect(contract).toEqual({ id: 'string|required', nota: 'string|optional' });
  });

  /**
   * `oneOf` describe ALTERNATIVAS. Marcar como obligatorio lo que sólo lo es en una rama haría que
   * el generador produjera casos «inválidos» que en realidad el endpoint acepta.
   */
  it('con `oneOf` recoge los campos pero no afirma obligatoriedad', () => {
    const contract = contractFromSchema(documentWith(), {
      oneOf: [
        { type: 'object', properties: { porEmail: { type: 'string' } }, required: ['porEmail'] },
        { type: 'object', properties: { porTelefono: { type: 'string' } }, required: ['porTelefono'] },
      ],
    });

    expect(contract).toEqual({ porEmail: 'string|optional', porTelefono: 'string|optional' });
  });

  it('resuelve un `$ref` hasta el esquema apuntado', () => {
    const document = documentWith({
      Login: { type: 'object', properties: { email: { type: 'string' } }, required: ['email'] },
    });

    expect(contractFromSchema(document, { $ref: '#/components/schemas/Login' })).toEqual({ email: 'string|required' });
  });

  /** Un esquema recursivo no puede colgar el arranque del catálogo. */
  it('un `$ref` cíclico se corta en vez de girar para siempre', () => {
    const document = documentWith({ Nodo: { $ref: '#/components/schemas/Nodo' } });

    expect(() => contractFromSchema(document, { $ref: '#/components/schemas/Nodo' })).not.toThrow();
  });

  it('sin propiedades no se inventa contrato', () => {
    expect(contractFromSchema(documentWith(), { type: 'object' })).toEqual({});
    expect(contractFromSchema(documentWith(), null)).toEqual({});
  });

  /** OpenAPI 3.1 expresa lo anulable como unión de tipos; el catálogo publica el tipo útil. */
  it('en una unión con `null` se queda con el tipo real', () => {
    const contract = contractFromSchema(documentWith(), {
      type: 'object',
      properties: { nota: { type: ['string', 'null'] } },
    });

    expect(contract.nota).toBe('string|optional');
  });
});

describe('contractsFromParameters', () => {
  it('separa query, path y cabeceras exigidas', () => {
    const result = contractsFromParameters(
      documentWith(),
      [
        { in: 'query', name: 'limit', required: false, schema: { type: 'integer' } },
        { in: 'header', name: 'x-idempotency-key', required: true, schema: { type: 'string' } },
        { in: 'header', name: 'accept', required: false, schema: { type: 'string' } },
      ],
      [{ in: 'path', name: 'customerId', required: true, schema: { type: 'string' } }],
    );

    expect(result.query).toEqual({ limit: 'integer|optional' });
    expect(result.path).toEqual({ customerId: 'string|required' });
    // Sólo las obligatorias: publicar `accept` llenaría el catálogo de ruido que no distingue
    // un endpoint de otro.
    expect(result.headers).toEqual({ 'x-idempotency-key': 'string|required' });
  });

  it('sin parámetros devuelve mapas vacíos, no undefined', () => {
    const result = contractsFromParameters(documentWith(), undefined, undefined);
    expect(result).toEqual({ query: {}, path: {}, headers: {} });
  });
});

describe('contractFromRequestBody', () => {
  it('lee el cuerpo `application/json`', () => {
    const contract = contractFromRequestBody(documentWith(), {
      content: { 'application/json': { schema: { type: 'object', properties: { total: { type: 'number' } }, required: ['total'] } } },
    });

    expect(contract).toEqual({ total: 'number|required' });
  });

  it('un medio que no es JSON no produce contrato', () => {
    expect(contractFromRequestBody(documentWith(), { content: { 'multipart/form-data': { schema: {} } } })).toEqual({});
  });
});

describe('successStatusCodes', () => {
  /**
   * Sólo 2xx. Un `400` documentado describe el fallo, no el contrato de salida: meterlo en «códigos
   * esperados» haría que el laboratorio de QA diera por buena una petición rechazada.
   */
  it('recoge sólo los códigos de éxito, ordenados', () => {
    expect(successStatusCodes({ '201': {}, '400': {}, '200': {}, '500': {} })).toEqual([200, 201]);
  });

  it('sin respuestas declaradas devuelve lista vacía, no un 200 supuesto', () => {
    expect(successStatusCodes(undefined)).toEqual([]);
  });
});
