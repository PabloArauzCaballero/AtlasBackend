import { describe, expect, it } from '@jest/globals';
import { BadRequestException } from '@nestjs/common';
import { resolveCurrentTenant } from '../../../../src/common/decorators/current-tenant.decorator.js';

/**
 * De dónde sale el tenant de una petición.
 *
 * Antes cada controller repetía `@Headers('x-tenant-id')` + `parsePositiveId(...)`: 27 controllers y
 * 130 copias, cada una una oportunidad de resolverlo distinto. Ahora la respuesta vive en un solo
 * sitio, así que aquí se prueba — incluido el 400, que es la garantía de que ninguna consulta acaba
 * corriendo sin frontera de tenant.
 */
describe('resolveCurrentTenant', () => {
  const resolve = (request: unknown): string => resolveCurrentTenant(request as never);

  it('toma el header cuando viene', () => {
    expect(resolve({ headers: { 'x-tenant-id': '7' }, user: { tenantId: '9' } })).toBe('7');
  });

  /** Un actor cuyo token ya declara su tenant no tiene por qué repetirlo en cada petición. */
  it('cae al tenant del token cuando no hay header', () => {
    expect(resolve({ headers: {}, user: { tenantId: '9' } })).toBe('9');
  });

  it('resuelve el header repetido tomando el primer valor', () => {
    expect(resolve({ headers: { 'x-tenant-id': ['5', '6'] }, user: undefined })).toBe('5');
  });

  it.each([
    ['sin header ni token', { headers: {}, user: undefined }],
    ['header vacío', { headers: { 'x-tenant-id': '' }, user: undefined }],
    ['header no numérico', { headers: { 'x-tenant-id': 'abc' }, user: undefined }],
    ['header en cero', { headers: { 'x-tenant-id': '0' }, user: undefined }],
    ['header negativo', { headers: { 'x-tenant-id': '-1' }, user: undefined }],
  ])('rechaza con 400: %s', (_caso, request) => {
    expect(() => resolve(request)).toThrow(BadRequestException);
  });
});
