import { describe, expect, it } from '@jest/globals';
import { SystemsTestAssertionService } from '../../../src/modules/systems-ops/systems-test-assertion.service.js';

/**
 * `SystemsTestAssertionService.evaluate` corre 5 tipos de aserción sobre la respuesta de un paso de
 * test (status, duración, existencia/igualdad/tipo por JSONPath) y devuelve el AND global. Servicio
 * puro: se prueba cada tipo y sus ramas de fallo.
 */
describe('SystemsTestAssertionService', () => {
  const service = new SystemsTestAssertionService();
  const base = { statusCode: 200, durationMs: 50, responseBody: { data: { id: 5, items: [1, 2] } }, assertions: {} };
  const named = (r: { results: { name: string; passed: boolean; message?: string }[] }, name: string) => r.results.find((x) => x.name === name);

  it('status por defecto acepta 200/201 y rechaza otros o null', () => {
    expect(service.evaluate({ ...base, statusCode: 200 }).results[0].passed).toBe(true);
    expect(service.evaluate({ ...base, statusCode: 500 }).results[0].passed).toBe(false);
    expect(service.evaluate({ ...base, statusCode: null }).results[0].passed).toBe(false);
  });

  it('respeta expectedStatusCodes explícitos', () => {
    const r = service.evaluate({ ...base, statusCode: 204, assertions: { expectedStatusCodes: [204] } });
    expect(r.results[0].passed).toBe(true);
  });

  it('maxDurationMs se omite si no es número; si lo es, compara', () => {
    expect(named(service.evaluate({ ...base, assertions: {} }), 'maxDurationMs')).toBeUndefined();
    expect(named(service.evaluate({ ...base, durationMs: 50, assertions: { maxDurationMs: 100 } }), 'maxDurationMs')?.passed).toBe(true);
    expect(named(service.evaluate({ ...base, durationMs: 200, assertions: { maxDurationMs: 100 } }), 'maxDurationMs')?.passed).toBe(false);
  });

  it('jsonPathExists marca found/no-found por path', () => {
    const r = service.evaluate({ ...base, assertions: { jsonPathExists: ['$.data.id', '$.nope'] } });
    expect(named(r, 'jsonPathExists:$.data.id')?.passed).toBe(true);
    expect(named(r, 'jsonPathExists:$.nope')?.passed).toBe(false);
  });

  it('jsonPathEquals compara por valor y avisa si el path no existe', () => {
    expect(named(service.evaluate({ ...base, assertions: { jsonPathEquals: { '$.data.id': 5 } } }), 'jsonPathEquals:$.data.id')?.passed).toBe(true);
    expect(named(service.evaluate({ ...base, assertions: { jsonPathEquals: { '$.data.id': 6 } } }), 'jsonPathEquals:$.data.id')?.passed).toBe(false);
    const missing = named(service.evaluate({ ...base, assertions: { jsonPathEquals: { '$.nope': 1 } } }), 'jsonPathEquals:$.nope');
    expect(missing?.passed).toBe(false);
    expect(missing?.message).toBe('JSONPath not found');
  });

  it('jsonPathType compara el tipo resuelto (object/array)', () => {
    const r = service.evaluate({ ...base, assertions: { jsonPathType: { '$.data': 'object', '$.data.items': 'array' } } });
    expect(named(r, 'jsonPathType:$.data')?.passed).toBe(true);
    expect(named(r, 'jsonPathType:$.data.items')?.passed).toBe(true);
  });

  it('passed global es el AND de todos los resultados', () => {
    expect(service.evaluate({ ...base, statusCode: 200, assertions: { jsonPathExists: ['$.data.id'] } }).passed).toBe(true);
    expect(service.evaluate({ ...base, statusCode: 500 }).passed).toBe(false);
  });
});
