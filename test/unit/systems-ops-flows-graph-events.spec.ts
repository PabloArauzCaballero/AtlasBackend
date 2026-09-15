import { consumidorDe, eventosDelFlujo } from '../../src/modules/systems-ops/system-flows.graph.events.js';
import { flowAnalysisSchema } from '../../src/modules/systems-ops/system-flows.schemas.js';

/**
 * El mapa de Flujos acababa en el endpoint, y un flujo que publica un evento no termina al responder.
 * Lo que se protege es que el nodo del evento diga quién lo recoge SIN afirmar que avisa, y sin llamar
 * «outbox» a un evento que `EventsService` rechaza antes de escribirlo.
 */
describe('eventos que publica un flujo', () => {
  it('el esquema de importación conserva los eventos y su vía, en vez de descartarlos en silencio', () => {
    const analisis = flowAnalysisSchema.parse({ events: [{ code: 'support.sla.breached', dynamic: false, at: 'a.ts:1' }] });
    expect(analisis.events).toEqual([{ code: 'support.sla.breached', dynamic: false, via: 'publish', at: 'a.ts:1' }]);
    expect(flowAnalysisSchema.parse({ events: [{ code: 'x', at: 'a', via: 'outbox' }] }).events[0]?.via).toBe('outbox');
    expect(flowAnalysisSchema.parse({}).events).toEqual([]);
  });

  it('registrado lo toma process_events, por cualquiera de las dos vías', () => {
    expect(consumidorDe('ATLAS_BACKEND', { code: 'support.sla.breached', dynamic: false, via: 'publish' })).toBe('PROCESS_EVENTS');
  });

  it('sin registro por publish se RECHAZA: EventsService lanza y nunca llega al outbox', () => {
    expect(consumidorDe('ATLAS_BACKEND', { code: 'codigo.que.nadie.registro', dynamic: false, via: 'publish' })).toBe(
      'RECHAZADO_SIN_REGISTRO',
    );
  });

  it('sin registro escrito directamente al outbox lo traga el job de compatibilidad', () => {
    expect(consumidorDe('ATLAS_BACKEND', { code: 'customer.lifecycle.*', dynamic: true, via: 'outbox' })).toBe('COMPATIBILIDAD');
  });

  it('un código armado en ejecución con prefijo registrado depende del valor', () => {
    expect(consumidorDe('ATLAS_BACKEND', { code: 'support.case.*', dynamic: true, via: 'publish' })).toBe('DEPENDE_DEL_VALOR');
  });

  it('de otro bloque no se opina: su registro no está aquí', () => {
    expect(consumidorDe('ERP_BACKEND', { code: 'invoice.issued', dynamic: false, via: 'publish' })).toBe('DESCONOCIDO');
  });

  it('cada evento sale como nodo con su consumidor y su vía, sin afirmar avisos', () => {
    const analisis = flowAnalysisSchema.parse({ events: [{ code: 'customer.lifecycle.*', dynamic: true, via: 'outbox', at: 'a.ts:1' }] });
    const [nodo] = eventosDelFlujo('ATLAS_BACKEND', analisis);
    expect(nodo).toMatchObject({ label: 'customer.lifecycle.*', meta: { consumer: 'COMPATIBILIDAD', via: 'outbox', dynamic: true } });
    expect(JSON.stringify(nodo)).not.toMatch(/avisa|notifica/i);
  });
});
