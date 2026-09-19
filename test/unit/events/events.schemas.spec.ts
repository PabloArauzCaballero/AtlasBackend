import { describe, expect, it } from '@jest/globals';
import { listEventsQuerySchema } from '../../../src/modules/events/events.schemas.js';

/**
 * El filtro `status` del outbox se acepta en cualquier caja. Los valores viven en minúsculas, pero
 * la pantalla los toma de una insignia que los pinta en mayúsculas: `PENDING` respondía 400 de
 * validación y se leía como un fallo del portal.
 */
describe('listEventsQuerySchema · status', () => {
  it('acepta el estado en mayúsculas y lo normaliza al valor almacenado', () => {
    const parsed = listEventsQuerySchema.parse({ status: 'PENDING' });
    expect(parsed.status).toBe('pending');
  });

  it('acepta el estado con espacios alrededor', () => {
    expect(listEventsQuerySchema.parse({ status: ' Failed ' }).status).toBe('failed');
  });

  it('sigue rechazando un estado que no existe', () => {
    expect(() => listEventsQuerySchema.parse({ status: 'archived' })).toThrow();
  });

  it('sin estado no filtra', () => {
    expect(listEventsQuerySchema.parse({}).status).toBeUndefined();
  });
});
