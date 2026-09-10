import { SystemFlowsAsyncService } from '../../src/modules/systems-ops/system-flows.async.service.js';

/**
 * El mapa de Flujos acababa en el endpoint. Un flujo que encola algo —un correo, una notificación,
 * un recálculo— parecía terminar ahí, y no termina: deja trabajo que alguien tiene que recoger
 * después. Esto lo hace visible cruzando los eventos REALES con la petición que los originó.
 *
 * Lo que se protege aquí son las tres distinciones que hacen útil el dato, porque sin ellas un
 * consumidor ausente y uno lento se leen igual, y «hay pendientes» —que es lo normal un segundo
 * después de encolar— se leería como una avería.
 */
const hace = (dias: number) => new Date(Date.now() - dias * 86_400_000);

const servicio = (filas: unknown[]) => new SystemFlowsAsyncService({ pendingWork: async () => filas } as never);

const fila = (over: Record<string, unknown> = {}) => ({
  method: 'POST',
  path: 'credit/applications',
  events: '4',
  pending: '4',
  processed: '0',
  other: '0',
  pending_since: hace(9),
  codes: ['credit_application_created'],
  ...over,
});

describe('SystemFlowsAsyncService.pendingWork', () => {
  it('un pendiente reciente NO es un atasco: acaba de encolarse', async () => {
    const { stuck, flows } = await servicio([fila({ pending_since: new Date() })]).pendingWork();
    expect(stuck).toEqual([]);
    expect(flows[0]).toMatchObject({ pending: 4, stuck: false });
  });

  it('un pendiente de días sí lo es, y se nombra el flujo', async () => {
    const { stuck } = await servicio([fila()]).pendingWork();
    expect(stuck).toEqual(['POST credit/applications']);
  });

  it('nunca procesado se distingue de ir con retraso: no es lento, es que nadie recoge', async () => {
    const conConsumidor = await servicio([fila({ processed: '10' })]).pendingWork();
    const sinConsumidor = await servicio([fila()]).pendingWork();
    expect(conConsumidor.flows[0].neverProcessed).toBe(false);
    expect(sinConsumidor.flows[0].neverProcessed).toBe(true);
  });

  it('el pendiente más antiguo manda, no el último: la pregunta es cuánto llevan sin recogerse', async () => {
    const { oldestPending } = await servicio([
      fila({ pending_since: hace(2) }),
      fila({ path: 'otro', pending_since: hace(30) }),
    ]).pendingWork();
    expect(oldestPending?.getTime()).toBeCloseTo(hace(30).getTime(), -4);
  });

  it('se dice cuántos flujos dejaron rastro: un cero puede ser «no encola nada» o «no se usó»', async () => {
    expect(await servicio([]).pendingWork()).toMatchObject({ flowsThatEnqueue: 0, pending: 0, stuck: [] });
  });
});
