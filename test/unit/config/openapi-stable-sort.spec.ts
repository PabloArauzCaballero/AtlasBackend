import { describe, expect, it } from '@jest/globals';
import { stableSortOpenApiDocument } from '../../../src/config/openapi/stable-sort.js';

describe('stableSortOpenApiDocument', () => {
  it('produce el mismo orden para rutas, métodos y esquemas sin alterar arrays semánticos', () => {
    const first = {
      paths: {
        '/z': { post: { tags: ['primero', 'segundo'] }, get: { tags: ['consulta'] } },
        '/a': { get: { tags: ['inicio'] } },
      },
      components: { schemas: { Zebra: { type: 'string' }, Alpha: { type: 'number' } } },
      tags: [{ name: 'segundo' }, { name: 'primero' }],
    };
    const second = {
      paths: {
        '/a': { get: { tags: ['inicio'] } },
        '/z': { get: { tags: ['consulta'] }, post: { tags: ['primero', 'segundo'] } },
      },
      components: { schemas: { Alpha: { type: 'number' }, Zebra: { type: 'string' } } },
      tags: [{ name: 'segundo' }, { name: 'primero' }],
    };

    expect(JSON.stringify(stableSortOpenApiDocument(first))).toBe(JSON.stringify(stableSortOpenApiDocument(second)));
    expect(Object.keys(first.paths)).toEqual(['/a', '/z']);
    expect(Object.keys(first.paths['/z'])).toEqual(['get', 'post']);
    expect(first.paths['/z'].post.tags).toEqual(['primero', 'segundo']);
    expect(first.tags).toEqual([{ name: 'segundo' }, { name: 'primero' }]);
  });
});
