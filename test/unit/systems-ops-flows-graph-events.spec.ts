import { consumidorDe, eventosDelFlujo } from '../../src/modules/systems-ops/system-flows.graph.events.js';
import { flowAnalysisSchema } from '../../src/modules/systems-ops/system-flows.schemas.js';

/**
 * El mapa de Flujos acababa en el endpoint, y un flujo que publica un evento no termina al responder.
 * Lo que se protege es que el nodo del evento diga quién lo recoge SIN afirmar que avisa: eso se mide
 * con los mensajes que salieron, no se deduce del código.
 */
describe('eventos que publica un flujo', () => {
  it('el esquema de importación conserva los eventos, en vez de descartarlos en silencio', () => {
    const analisis = flowAnalysisSchema.parse({ events: [{ code: 'support.sla.breached', dynamic: false, at: 'a.ts:1' }] });
    expect(analisis.events).toEqual([{ code: 'support.sla.breached', dynamic: false, at: 'a.ts:1' }]);
    expect(flowAnalysisSchema.parse({}).events).toEqual([]);
  });

  it('registrado lo toma process_events; sin registro lo traga el outbox de compatibilidad', () => {
    expect(consumidorDe('ATLAS_BACKEND', { code: 'support.sla.breached', dynamic: false })).toBe('PROCESS_EVENTS');
    expect(consumidorDe('ATLAS_BACKEND', { code: 'codigo.que.nadie.registro', dynamic: false })).toBe('COMPATIBILIDAD');
  });

  it('un código armado en ejecución sólo se clasifica por su prefijo, y lo dice', () => {
    // `customer.lifecycle.*` no tiene ningún código registrado: es el caso que se tragaba el outbox.
    expect(consumidorDe('ATLAS_BACKEND', { code: 'customer.lifecycle.*', dynamic: true })).toBe('COMPATIBILIDAD');
    expect(consumidorDe('ATLAS_BACKEND', { code: 'support.case.*', dynamic: true })).toBe('DEPENDE_DEL_VALOR');
  });

  it('de otro bloque no se opina: su registro no está aquí', () => {
    expect(consumidorDe('ERP_BACKEND', { code: 'invoice.issued', dynamic: false })).toBe('DESCONOCIDO');
  });

  it('cada evento sale como nodo con su consumidor y sin afirmar avisos', () => {
    const analisis = flowAnalysisSchema.parse({ events: [{ code: 'support.sla.breached', dynamic: false, at: 'a.ts:1' }] });
    const [nodo] = eventosDelFlujo('ATLAS_BACKEND', analisis);
    expect(nodo).toMatchObject({
      id: 'event:ATLAS_BACKEND:support.sla.breached',
      label: 'support.sla.breached',
      meta: { consumer: 'PROCESS_EVENTS' },
    });
    expect(JSON.stringify(nodo)).not.toMatch(/avisa|notifica/i);
  });
});
