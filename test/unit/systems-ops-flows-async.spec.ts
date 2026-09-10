import { SystemFlowsAsyncService } from '../../src/modules/systems-ops/system-flows.async.service.js';
import { OUTBOX_HEALTH_SQL, PENDING_WORK_SQL } from '../../src/modules/systems-ops/system-flows.sql.constants.js';

/**
 * El mapa de Flujos acababa en el endpoint. Un flujo que encola algo parecía terminar al responder,
 * y no termina: deja trabajo que alguien tiene que recoger después.
 *
 * Lo que se protege aquí son las distinciones que separan una avería de un artefacto, porque las
 * dos primeras versiones las confundieron con datos reales delante:
 *
 * - En local no hay worker. La primera versión enseñó 447 pendientes y 6 flujos «atascados» que
 *   nadie iba a recoger nunca AHÍ. No era una avería del sistema: era el entorno.
 * - En el servidor el consumidor sí corre, y aun así dejaba 67 eventos sin tomar desde el 23 de
 *   agosto: los de inquilino nulo. Ése SÍ era una avería, y el job salía en verde.
 */
const MIN = 60_000;
const DIA = 86_400_000;
const hace = (ms: number) => new Date(Date.now() - ms);

function servicio(filas: unknown[], salud: Record<string, unknown> = {}) {
  return new SystemFlowsAsyncService({
    pendingWork: async () => filas,
    outboxHealth: async () => ({
      pending: String((filas as Array<{ pending?: string }>).reduce((n, f) => n + Number(f.pending ?? 0), 0)),
      pending_without_tenant: '0',
      failed: '0',
      oldest_pending: null,
      consumer_last_run: hace(1 * MIN),
      ...salud,
    }),
  } as never);
}

const fila = (over: Record<string, unknown> = {}) => ({
  method: 'POST',
  path: 'internal/auth/refresh',
  events: '4',
  pending: '4',
  processed: '0',
  failed: '0',
  other: '0',
  pending_without_tenant: '0',
  pending_since: hace(9 * DIA),
  last_processed_at: null,
  codes: ['post_api_v1_internal_auth_refresh_completed'],
  ...over,
});

describe('SystemFlowsAsyncService.pendingWork · entorno frente a avería', () => {
  it('sin consumidor que corra, NO se acusa a ningún flujo: es el entorno, no una avería', async () => {
    const r = await servicio([fila()], { consumer_last_run: hace(6 * DIA) }).pendingWork();
    expect(r).toMatchObject({ diagnosis: 'SIN_CONSUMIDOR', skipped: [], consumer: { running: false } });
  });

  it('sin ninguna corrida registrada, igual: no se inventa un consumidor que salte eventos', async () => {
    const r = await servicio([fila()], { consumer_last_run: null }).pendingWork();
    expect(r).toMatchObject({ diagnosis: 'SIN_CONSUMIDOR', skipped: [] });
  });

  it('con el consumidor corriendo y pendientes de días, SÍ es una avería: los vio y no los tomó', async () => {
    const r = await servicio([fila()]).pendingWork();
    expect(r).toMatchObject({ diagnosis: 'SALTADOS', skipped: ['POST internal/auth/refresh'] });
  });

  it('un pendiente reciente no se acusa aunque el consumidor corra: es el ritmo normal de drenado', async () => {
    const r = await servicio([fila({ pending_since: hace(2 * MIN) })]).pendingWork();
    expect(r).toMatchObject({ diagnosis: 'AL_DIA', skipped: [] });
  });
});

describe('SystemFlowsAsyncService.pendingWork · lo que no debe desaparecer del recuento', () => {
  it('los pendientes sin inquilino se enseñan aparte: fueron la avería real que esto destapó', async () => {
    const r = await servicio([fila()], { pending_without_tenant: '67' }).pendingWork();
    expect(r.pendingWithoutTenant).toBe(67);
  });

  it('lo que no se pudo atribuir a ninguna petición se cuenta, en vez de perderse en el cruce', async () => {
    const r = await servicio([fila({ pending: '4' })], { pending: '10' }).pendingWork();
    expect(r).toMatchObject({ pending: 10, unattributedPending: 6 });
  });

  it('un flujo que falla aparece en `failing` aunque no tenga ni un pendiente', async () => {
    const r = await servicio([fila({ pending: '0', failed: '3', pending_since: null })]).pendingWork();
    expect(r.failing).toEqual(['POST internal/auth/refresh']);
  });

  it('se da la fecha del último procesado, no un «nunca» que dependa de la ventana', async () => {
    const cuando = hace(9 * DIA);
    const r = await servicio([fila({ processed: '2', last_processed_at: cuando })]).pendingWork();
    expect(r.flows[0].lastProcessedAt?.getTime()).toBe(cuando.getTime());
  });
});

describe('las consultas que alimentan el diagnóstico', () => {
  /**
   * Ninguna prueba ejecutaba el SQL, y tres de los fallos vivían ahí. No sustituye a correrlo contra
   * una base, pero fija las tres condiciones cuya ausencia producía un dato plausible y falso.
   */
  it('el evento se ata a SU petición: método, ruta y éxito, no sólo la correlación', () => {
    // La app reutiliza el mismo id en la petición con 401, el refresh y el reintento: sin esto un
    // evento se contaba tres veces y se atribuía a un GET que nunca encola.
    expect(PENDING_WORK_SQL).toMatch(/l\.method = e\.ev_method/);
    expect(PENDING_WORK_SQL).toMatch(/l\.resolved_url_sanitized = e\.ev_path/);
    expect(PENDING_WORK_SQL).toMatch(/response_status_code < 400/);
    expect(PENDING_WORK_SQL).toMatch(/DISTINCT ON \(e\._id\)/);
  });

  it('la ventana limita sólo lo procesado: un pendiente viejo nunca se sale del recuento', () => {
    expect(PENDING_WORK_SQL).toMatch(/o\.status <> 'processed'\s+OR o\._created_at >=/);
  });

  it('se ordena por lo más antiguo, para que el tope no corte primero los atascos', () => {
    expect(PENDING_WORK_SQL).toMatch(/ORDER BY MIN\(_created_at\) FILTER \(WHERE status IN \('pending', 'failed'\)\) ASC/);
  });

  it('la salud del consumidor sale de sus corridas COMPLETADAS, no de las que empezaron', () => {
    expect(OUTBOX_HEALTH_SQL).toMatch(/job_code = 'process_outbox' AND status = 'completed'/);
  });
});
