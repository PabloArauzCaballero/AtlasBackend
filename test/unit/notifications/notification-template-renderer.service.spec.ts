import { describe, expect, it } from '@jest/globals';
import { NotificationTemplateRendererService } from '../../../src/modules/notifications/notification-template-renderer.service.js';

/**
 * ATLAS-P12 (continuación de `docs/testing/PLAN_RED_DE_PRUEBAS_ATLAS_P12.md` §9): motor de
 * interpolación `{{path.to.value}}` usado por todo mensaje de notificación real que se le envía
 * a un cliente o comercio. Lógica pura, sin dependencias — candidata perfecta para cobertura
 * completa.
 */
describe('NotificationTemplateRendererService.render', () => {
  const service = new NotificationTemplateRendererService();

  it('uses the fallback text when the template is null', () => {
    expect(service.render(null, {}, 'fallback text')).toBe('fallback text');
  });

  it('uses the fallback text when the template is an empty/whitespace-only string', () => {
    expect(service.render('   ', {}, 'fallback text')).toBe('fallback text');
  });

  it('interpolates a top-level placeholder from the payload', () => {
    expect(service.render('Hola {{name}}', { name: 'Ana' }, 'fallback')).toBe('Hola Ana');
  });

  it('interpolates a nested placeholder using dot notation', () => {
    expect(service.render('Monto: {{purchase.amount}}', { purchase: { amount: 100 } }, 'fallback')).toBe('Monto: 100');
  });

  it('resolves a missing path to an empty string, not the literal "undefined"', () => {
    expect(service.render('Valor: {{missing.path}}', {}, 'fallback')).toBe('Valor: ');
  });

  it('resolves null/undefined leaf values to an empty string', () => {
    expect(service.render('Valor: {{x}}', { x: null }, 'fallback')).toBe('Valor: ');
  });

  it('formats a Date value as an ISO string', () => {
    const date = new Date('2026-01-01T00:00:00.000Z');
    expect(service.render('Fecha: {{when}}', { when: date }, 'fallback')).toBe('Fecha: 2026-01-01T00:00:00.000Z');
  });

  it('formats a plain object value as JSON, not "[object Object]"', () => {
    expect(service.render('Detalle: {{extra}}', { extra: { a: 1 } }, 'fallback')).toBe('Detalle: {"a":1}');
  });

  it('interpolates multiple placeholders in the same template', () => {
    expect(service.render('{{a}} y {{b}}', { a: '1', b: '2' }, 'fallback')).toBe('1 y 2');
  });

  it('tolerates extra whitespace inside the placeholder braces', () => {
    expect(service.render('{{  name  }}', { name: 'Ana' }, 'fallback')).toBe('Ana');
  });

  it('leaves text with no placeholders unchanged', () => {
    expect(service.render('texto plano sin variables', { anything: 'x' }, 'fallback')).toBe('texto plano sin variables');
  });

  it('does not crash and returns an empty segment when traversing into a non-object value', () => {
    expect(service.render('{{a.b}}', { a: 'just a string' }, 'fallback')).toBe('');
  });
});
