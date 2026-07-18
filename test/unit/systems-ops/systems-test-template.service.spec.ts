import { describe, expect, it, jest } from '@jest/globals';
import { BadRequestException } from '@nestjs/common';
import { SystemsTestTemplateService } from '../../../src/modules/systems-ops/systems-test-template.service.js';

/**
 * `SystemsTestTemplateService` resuelve plantillas `{{ scope.path }}` de los pasos de test contra el
 * config/contexto/último resultado. Servicio puro (sin dependencias): se prueban la preservación de
 * tipo en un match completo, la interpolación con stringify, la recursión y los errores de scope/valor.
 */
describe('SystemsTestTemplateService', () => {
  const service = new SystemsTestTemplateService();
  const ctx = {
    config: { foo: 'bar', num: 7, obj: { x: 1 } },
    context: { user: { id: 'u1' } },
    last: { status: 200 },
  };

  it('un match completo preserva el tipo del valor resuelto (string/number/objeto)', () => {
    expect(service.resolveString('{{ config.foo }}', ctx)).toBe('bar');
    expect(service.resolveString('{{ config.num }}', ctx)).toBe(7);
    expect(service.resolveString('{{ config.obj }}', ctx)).toEqual({ x: 1 });
  });

  it('interpola y stringifica cuando hay texto o varios tokens', () => {
    expect(service.resolveString('Hola {{ config.foo }}!', ctx)).toBe('Hola bar!');
    expect(service.resolveString('n={{ config.num }} o={{ config.obj }}', ctx)).toBe('n=7 o={"x":1}');
  });

  it('sin plantilla devuelve el string tal cual', () => {
    expect(service.resolveString('sin plantilla', ctx)).toBe('sin plantilla');
  });

  it('resuelve los scopes config, context y last', () => {
    expect(service.resolveString('{{ config.foo }}', ctx)).toBe('bar');
    expect(service.resolveString('{{ context.user }}', ctx)).toEqual({ id: 'u1' });
    expect(service.resolveString('{{ last.status }}', ctx)).toBe(200);
  });

  it('lanza BadRequest ante un scope no soportado', () => {
    expect(() => service.resolveString('{{ bad.x }}', ctx)).toThrow(BadRequestException);
  });

  it('lanza BadRequest cuando el valor no existe en el scope', () => {
    expect(() => service.resolveString('{{ config.missing }}', ctx)).toThrow(BadRequestException);
  });

  it('resolveValue recurre en arrays/objetos y deja pasar los primitivos', () => {
    expect(service.resolveValue(42, ctx)).toBe(42);
    expect(service.resolveValue(null, ctx)).toBeNull();
    expect(service.resolveValue({ a: '{{ config.foo }}', b: [1, '{{ config.num }}'] }, ctx)).toEqual({ a: 'bar', b: [1, 7] });
  });
});
