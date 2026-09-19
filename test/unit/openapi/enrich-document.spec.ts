import { describe, expect, it } from '@jest/globals';
import { enrichOpenApiDocument } from '../../../src/config/openapi/enrich-document.js';

/**
 * Lo que Nest NO puede saber, y este paso completa.
 *
 * El generador deriva el contrato de los decoradores, así que sólo sabe lo que cada endpoint
 * declaró de sí mismo. Todo lo transversal —el sobre de éxito, los errores que cualquier ruta puede
 * devolver, los parámetros que la plantilla de la URL exige— no vive en ningún decorador y, sin
 * esto, salía del generador ausente.
 *
 * Lo que se fija aquí son las reglas que, si se rompen, publican un contrato que MIENTE: un cliente
 * generado a partir de él compila y falla contra la API real. Ninguna de las cinco lanza un error
 * al generarse.
 */

type Doc = Record<string, unknown>;

function documento(operacion: Record<string, unknown>, ruta = '/things', metodo = 'get'): Doc {
  return { openapi: '3.1.0', paths: { [ruta]: { [metodo]: operacion } }, components: {} };
}

function operacionDe(doc: Doc, ruta = '/things', metodo = 'get') {
  return ((doc.paths as Record<string, Record<string, Record<string, unknown>>>)[ruta] ?? {})[metodo] ?? {};
}

describe('enrichOpenApiDocument', () => {
  describe('los parámetros que la plantilla de la ruta exige', () => {
    /*
     * Un handler que valida con `@Param(new ZodValidationPipe(schema))` recibe el objeto entero, y
     * de ahí Nest no puede deducir qué segmentos son variables. El contrato salía con rutas como
     * `/a/{customerId}/b/{referenceId}` sin declarar ninguno de los dos, y un generador de cliente
     * producía un método sin argumentos y una URL literal con llaves.
     */
    it('declara los que faltan, leyéndolos de la propia URL', () => {
      const doc = documento({ responses: {} }, '/a/{customerId}/b/{referenceId}');

      enrichOpenApiDocument(doc);

      const parametros = operacionDe(doc, '/a/{customerId}/b/{referenceId}').parameters as Array<Record<string, unknown>>;
      const deRuta = parametros.filter((p) => p.in === 'path');
      expect(deRuta.map((p) => p.name)).toEqual(expect.arrayContaining(['customerId', 'referenceId']));
      expect(deRuta.every((p) => p.required === true)).toBe(true);
    });

    /* Quien lo declaró con `@ApiParam` sabe más: su tipo y su descripción no se pisan. */
    it('no toca el que la operación ya declaró', () => {
      const doc = documento(
        {
          parameters: [{ name: 'customerId', in: 'path', required: true, description: 'El titular.', schema: { type: 'integer' } }],
          responses: {},
        },
        '/a/{customerId}',
      );

      enrichOpenApiDocument(doc);

      const declarado = (operacionDe(doc, '/a/{customerId}').parameters as Array<Record<string, unknown>>).find(
        (p) => p.name === 'customerId',
      );
      expect(declarado?.schema).toEqual({ type: 'integer' });
      expect(declarado?.description).toBe('El titular.');
    });
  });

  describe('el sobre de éxito', () => {
    it('envuelve la carga declarada dentro de `data`, sin perderla', () => {
      const doc = documento({
        responses: {
          '200': {
            description: 'ok',
            content: { 'application/json': { schema: { type: 'object', properties: { id: { type: 'string' } } } } },
          },
        },
      });

      enrichOpenApiDocument(doc);

      const esquema = (operacionDe(doc).responses as Record<string, { content: Record<string, { schema: Record<string, unknown> }> }>)[
        '200'
      ].content['application/json'].schema;
      expect(esquema.allOf).toEqual([
        { $ref: '#/components/schemas/ApiSuccess' },
        { type: 'object', properties: { data: { type: 'object', properties: { id: { type: 'string' } } } } },
      ]);
    });

    /* 204 no lleva cuerpo: envolverlo documentaría algo que la API no emite. */
    it('deja el 204 sin cuerpo', () => {
      const doc = documento({ responses: { '204': { description: 'sin contenido' } } });

      enrichOpenApiDocument(doc);

      expect((operacionDe(doc).responses as Record<string, Record<string, unknown>>)['204'].content).toBeUndefined();
    });
  });

  describe('los errores que se deducen del propio documento', () => {
    /*
     * El criterio es conservador a propósito: sólo se añade lo que se deduce de un hecho
     * comprobable —hay seguridad declarada, hay parámetro de ruta, el método muta—, nunca de una
     * suposición sobre el handler.
     */
    it('añade 401 y 403 sólo donde la operación autentica', () => {
      const publico = documento({ responses: { '200': { description: 'ok' } } });
      const privado = documento({ security: [{ 'access-token': [] }], responses: { '200': { description: 'ok' } } });

      enrichOpenApiDocument(publico);
      enrichOpenApiDocument(privado);

      expect(Object.keys(operacionDe(publico).responses as object)).not.toContain('401');
      expect(Object.keys(operacionDe(privado).responses as object)).toEqual(expect.arrayContaining(['401', '403']));
    });

    it('añade 409 en las mutaciones y no en las lecturas', () => {
      const lectura = documento({ responses: { '200': { description: 'ok' } } }, '/things', 'get');
      const mutacion = documento({ responses: { '200': { description: 'ok' } } }, '/things', 'post');

      enrichOpenApiDocument(lectura);
      enrichOpenApiDocument(mutacion);

      expect(Object.keys(operacionDe(lectura, '/things', 'get').responses as object)).not.toContain('409');
      expect(Object.keys(operacionDe(mutacion, '/things', 'post').responses as object)).toContain('409');
    });

    it('el 429 y el 500 van en todas: el throttler y el filtro son globales', () => {
      const doc = documento({ responses: { '200': { description: 'ok' } } });

      enrichOpenApiDocument(doc);

      expect(Object.keys(operacionDe(doc).responses as object)).toEqual(expect.arrayContaining(['429', '500']));
    });

    /* Quien documentó su propio 404 con una descripción específica sabe más que esta regla. */
    it('no pisa una respuesta que el controlador ya declaró', () => {
      const doc = documento(
        { responses: { '200': { description: 'ok' }, '409': { description: 'El NIT ya tiene expediente.' } } },
        '/things',
        'post',
      );

      enrichOpenApiDocument(doc);

      expect((operacionDe(doc, '/things', 'post').responses as Record<string, Record<string, unknown>>)['409'].description).toBe(
        'El NIT ya tiene expediente.',
      );
    });
  });

  /*
   * `@Public()` sale del generador con una entrada de seguridad de nombre vacío. Dejarla haría que
   * un cliente generado pidiera credenciales para una ruta que no las quiere.
   */
  it('convierte la marca de público en «sin seguridad», no en «seguridad rara»', () => {
    const doc = documento({ security: [{ '': [] }], responses: { '200': { description: 'ok' } } });

    enrichOpenApiDocument(doc);

    expect(operacionDe(doc).security).toEqual([]);
  });

  it('registra los componentes transversales una sola vez', () => {
    const doc = documento({ responses: { '200': { description: 'ok' } } });

    enrichOpenApiDocument(doc);

    const componentes = doc.components as { schemas: Record<string, unknown>; responses: Record<string, unknown> };
    expect(Object.keys(componentes.schemas)).toEqual(expect.arrayContaining(['ApiSuccess', 'ApiError']));
    expect(Object.keys(componentes.responses)).toEqual(expect.arrayContaining(['TooManyRequests', 'InternalError']));
  });

  it('devuelve el MISMO documento, no una copia', () => {
    const doc = documento({ responses: {} });

    expect(enrichOpenApiDocument(doc)).toBe(doc);
  });
});
