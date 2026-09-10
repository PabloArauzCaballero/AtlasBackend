import { describe, expect, it, jest } from '@jest/globals';
import { SupportSlaService } from '../../../src/modules/support/application/support-sla.service.js';

/**
 * Los relojes del acuerdo de servicio.
 *
 * Lo que se fija aquí son las cuatro decisiones que, si se invierten, producen un tablero verde con
 * clientes esperando: un reloj que se cierra como CUMPLIDO aunque la respuesta llegara tarde, una
 * pausa que congela el vencimiento sin correrlo —o al revés, un estado de espera que pausa aunque
 * la política diga que el tiempo es total—, y un incumplimiento que sólo existe en una columna y no
 * en el expediente que después se audita.
 */

type Reloj = Record<string, unknown>;

function montar(relojes: Reloj[] = []) {
  const actualizaciones: Array<[string, Record<string, unknown>]> = [];
  const eventosDeCaso: Array<Record<string, unknown>> = [];
  const publicados: Array<Record<string, unknown>> = [];

  const timeline = {
    createClock: jest.fn(async (valores: never) => valores),
    findClock: jest.fn(async (_caseId: string, metricType: string) => relojes.find((r) => r.metricType === metricType) ?? null),
    listClocks: jest.fn(async () => relojes),
    updateClock: jest.fn(async (id: string, valores: Record<string, unknown>) => void actualizaciones.push([id, valores])),
    findBreachedClocks: jest.fn(async () => relojes),
    findWarningClocks: jest.fn(async () => relojes),
  };
  const cases = { appendEvent: jest.fn(async (e: never) => void eventosDeCaso.push(e as Record<string, unknown>)) };
  const catalog = {};
  const events = { publish: jest.fn(async (e: never) => void publicados.push(e as Record<string, unknown>)) };
  const sequelize = { transaction: jest.fn(async (fn: (t: unknown) => Promise<unknown>) => fn({})) };

  const service = new SupportSlaService(sequelize as never, timeline as never, cases as never, catalog as never, events as never);
  return { service, timeline, cases, events, actualizaciones, eventosDeCaso, publicados };
}

const politica = (over: Record<string, unknown> = {}) =>
  ({
    id: '7',
    calendarKind: 'CONTINUOUS',
    timezone: 'America/La_Paz',
    businessHoursJson: null,
    acknowledgeTargetMinutes: 5,
    firstResponseTargetMinutes: 30,
    resolutionTargetMinutes: 240,
    pauseOnWaitingCustomer: false,
    pauseOnWaitingPartner: false,
    pauseOnWaitingInternal: false,
    ...over,
  }) as never;

describe('SupportSlaService · arranque de los relojes', () => {
  it('arranca los tres relojes con el plazo de cada métrica y guarda la versión de política', async () => {
    const { service, timeline } = montar();
    const openedAt = new Date('2026-09-09T12:00:00.000Z');

    await service.startClocks({ tenantId: '1', caseId: '10', policy: politica(), openedAt, transaction: {} as never });

    const creados = timeline.createClock.mock.calls.map(([v]) => v as Record<string, unknown>);
    expect(creados.map((c) => c.metricType)).toEqual(['ACKNOWLEDGE', 'FIRST_RESPONSE', 'RESOLUTION']);
    // La versión viaja en el RELOJ, no sólo en el caso: es lo que se consulta al medir, y una
    // reclasificación posterior no debe reescribir con qué plazo se midió lo ya corrido.
    expect(creados.every((c) => c.policyVersionId === '7')).toBe(true);
    expect(creados.every((c) => c.state === 'RUNNING')).toBe(true);
  });

  /* Sin política no hay promesa que medir: crear relojes sin plazo sería inventarse un objetivo. */
  it('no arranca ninguno si el caso no tiene política', async () => {
    const { service, timeline } = montar();

    await service.startClocks({ tenantId: '1', caseId: '10', policy: null, openedAt: new Date(), transaction: {} as never });

    expect(timeline.createClock).not.toHaveBeenCalled();
  });
});

describe('SupportSlaService · cierre de un reloj', () => {
  /*
   * Es la regla que separa «se resolvió» de «se respondió a tiempo». Cerrar como CUMPLIDO algo que
   * llegó tarde es exactamente lo que hace que un tablero verde conviva con clientes esperando.
   */
  it('cierra como BREACHED lo que llegó después del objetivo', async () => {
    const { service, actualizaciones } = montar([
      { id: '1', metricType: 'FIRST_RESPONSE', targetAt: '2026-09-09T12:30:00.000Z', satisfiedAt: null, breachedAt: null },
    ]);

    await service.satisfyClock({ caseId: '10', metricType: 'FIRST_RESPONSE', at: new Date('2026-09-09T12:31:00.000Z') });

    expect(actualizaciones[0][1].state).toBe('BREACHED');
    expect(actualizaciones[0][1].satisfiedAt).toEqual(new Date('2026-09-09T12:31:00.000Z'));
  });

  it('cierra como MET lo que llegó a tiempo', async () => {
    const { service, actualizaciones } = montar([
      { id: '1', metricType: 'FIRST_RESPONSE', targetAt: '2026-09-09T12:30:00.000Z', satisfiedAt: null, breachedAt: null },
    ]);

    await service.satisfyClock({ caseId: '10', metricType: 'FIRST_RESPONSE', at: new Date('2026-09-09T12:29:00.000Z') });

    expect(actualizaciones[0][1].state).toBe('MET');
  });

  /* Un reloj ya cerrado no se reabre: la primera respuesta ocurre una sola vez. */
  it('no vuelve a cerrar uno ya satisfecho', async () => {
    const { service, timeline } = montar([
      { id: '1', metricType: 'FIRST_RESPONSE', targetAt: '2026-09-09T12:30:00.000Z', satisfiedAt: '2026-09-09T12:10:00.000Z' },
    ]);

    await service.satisfyClock({ caseId: '10', metricType: 'FIRST_RESPONSE', at: new Date() });

    expect(timeline.updateClock).not.toHaveBeenCalled();
  });
});

describe('SupportSlaService · pausa y reanudación', () => {
  /*
   * La pausa NO es automática por estar esperando: depende de que la política lo permita. Si un
   * acuerdo que cuenta tiempo total se congelara al poner el caso «en espera del cliente», bastaría
   * ese estado para que ningún caso incumpliera jamás.
   */
  it('no pausa por esperar al cliente si la política no lo permite', async () => {
    const { service, timeline } = montar([
      { id: '1', metricType: 'RESOLUTION', targetAt: '2026-09-09T16:00:00.000Z', satisfiedAt: null, pausedAt: null, totalPausedSeconds: 0 },
    ]);

    const resultado = await service.applyStatusChange({
      caseId: '10',
      status: 'WAITING_CUSTOMER' as never,
      policy: politica({ pauseOnWaitingCustomer: false }),
      at: new Date(),
      transaction: {} as never,
    });

    expect(resultado).toBe('unchanged');
    expect(timeline.updateClock).not.toHaveBeenCalled();
  });

  it('pausa cuando la política sí lo permite', async () => {
    const { service, actualizaciones } = montar([
      { id: '1', metricType: 'RESOLUTION', targetAt: '2026-09-09T16:00:00.000Z', satisfiedAt: null, pausedAt: null, totalPausedSeconds: 0 },
    ]);

    const resultado = await service.applyStatusChange({
      caseId: '10',
      status: 'WAITING_CUSTOMER' as never,
      policy: politica({ pauseOnWaitingCustomer: true }),
      at: new Date('2026-09-09T13:00:00.000Z'),
      transaction: {} as never,
    });

    expect(resultado).toBe('paused');
    expect(actualizaciones[0][1].state).toBe('PAUSED');
  });

  /* `ON_HOLD` pausa siempre: es el estado que dice explícitamente «esto no está corriendo». */
  it('ON_HOLD pausa aunque la política no marque ninguna espera', async () => {
    const { service } = montar([
      { id: '1', metricType: 'RESOLUTION', targetAt: '2026-09-09T16:00:00.000Z', satisfiedAt: null, pausedAt: null, totalPausedSeconds: 0 },
    ]);

    expect(
      await service.applyStatusChange({
        caseId: '10',
        status: 'ON_HOLD' as never,
        policy: politica(),
        at: new Date(),
        transaction: {} as never,
      }),
    ).toBe('paused');
  });

  /* Pausar sin mover el vencimiento sería no pausar: el objetivo se corre lo que duró la pausa. */
  it('al reanudar corre el vencimiento lo que duró la pausa, y lo acumula', async () => {
    const { service, actualizaciones } = montar([
      {
        id: '1',
        metricType: 'RESOLUTION',
        targetAt: '2026-09-09T16:00:00.000Z',
        satisfiedAt: null,
        pausedAt: '2026-09-09T13:00:00.000Z',
        totalPausedSeconds: 120,
      },
    ]);

    const resultado = await service.applyStatusChange({
      caseId: '10',
      status: 'IN_PROGRESS' as never,
      policy: politica(),
      at: new Date('2026-09-09T13:30:00.000Z'),
      transaction: {} as never,
    });

    expect(resultado).toBe('resumed');
    const valores = actualizaciones[0][1] as { targetAt: Date; totalPausedSeconds: number; pausedAt: null };
    expect(valores.pausedAt).toBeNull();
    expect(valores.totalPausedSeconds).toBe(120 + 1800);
    expect(valores.targetAt.toISOString()).toBe('2026-09-09T16:30:00.000Z');
  });
});

describe('SupportSlaService · cancelación y barrido', () => {
  it('cancela lo que sigue corriendo, y respeta lo ya cerrado', async () => {
    const { service, actualizaciones } = montar([
      { id: '1', metricType: 'ACKNOWLEDGE', state: 'MET', satisfiedAt: '2026-09-09T12:01:00.000Z' },
      { id: '2', metricType: 'FIRST_RESPONSE', state: 'BREACHED', satisfiedAt: null },
      { id: '3', metricType: 'RESOLUTION', state: 'RUNNING', satisfiedAt: null },
    ]);

    await service.cancelRunningClocks('10', {} as never);

    expect(actualizaciones).toEqual([['3', { state: 'CANCELLED' }]]);
  });

  /*
   * El incumplimiento tiene que quedar en el EXPEDIENTE, no sólo en una columna del reloj: quien
   * reconstruya la historia del caso —una revisión, un reclamo, el propio cliente— tiene que
   * encontrar que se prometió algo y no se cumplió.
   */
  it('el barrido marca, escribe en el expediente y publica el evento', async () => {
    const { service, actualizaciones, eventosDeCaso, publicados } = montar([
      { id: '9', caseId: '10', metricType: 'RESOLUTION', targetAt: '2026-09-09T16:00:00.000Z' },
    ]);

    const resultado = await service.sweepBreaches('1', new Date('2026-09-09T16:45:00.000Z'));

    expect(resultado.breached).toBe(1);
    expect(actualizaciones[0][1].state).toBe('BREACHED');
    expect(eventosDeCaso[0].eventType).toBe('SLA_BREACHED');
    expect(publicados).toHaveLength(1);
  });

  /*
   * El evento de integración va por outbox y su fallo no puede tumbar el barrido: si el motor de
   * notificaciones está caído, el incumplimiento igual tiene que quedar marcado.
   */
  it('si el evento de integración falla, el incumplimiento igual queda marcado', async () => {
    const { service, events, actualizaciones } = montar([
      { id: '9', caseId: '10', metricType: 'RESOLUTION', targetAt: '2026-09-09T16:00:00.000Z' },
    ]);
    events.publish.mockRejectedValueOnce(new Error('outbox caído') as never);

    const resultado = await service.sweepBreaches('1', new Date('2026-09-09T16:45:00.000Z'));

    expect(resultado.breached).toBe(1);
    expect(actualizaciones[0][1].state).toBe('BREACHED');
  });
});
