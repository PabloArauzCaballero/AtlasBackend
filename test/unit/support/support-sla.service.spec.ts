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

function montar(relojes: Reloj[] = [], umbrales: number[] = [50, 75, 90], versionPrevia: string | null = null) {
  const actualizaciones: Array<[string, Record<string, unknown>]> = [];
  const eventosDeCaso: Array<Record<string, unknown>> = [];
  const publicados: Array<Record<string, unknown>> = [];

  const timeline = {
    createClock: jest.fn(async (valores: never) => valores),
    findClock: jest.fn(async (_caseId: string, metricType: string) => relojes.find((r) => r.metricType === metricType) ?? null),
    listClocks: jest.fn(async () => relojes),
    updateClock: jest.fn(async (id: string, valores: Record<string, unknown>) => void actualizaciones.push([id, valores])),
    markClockBreached: jest.fn(async (id: string, breachedAt: Date) => {
      actualizaciones.push([id, { state: 'BREACHED', breachedAt }]);
      return true;
    }),
    findBreachedClocks: jest.fn(async () => relojes),
    findWarningClocks: jest.fn(async () => relojes),
    findRunningClocks: jest.fn(async () => relojes),
  };
  const cases = { appendEvent: jest.fn(async (e: never) => void eventosDeCaso.push(e as Record<string, unknown>)) };
  const catalog = { findSlaPolicyById: jest.fn(async () => ({ warningPercentsJson: umbrales })) };
  const events = { publish: jest.fn(async (e: never) => void publicados.push(e as Record<string, unknown>)) };
  const sequelize = {
    transaction: jest.fn(async (fn: (t: unknown) => Promise<unknown>) => fn({})),
    // La versión siguiente del agregado en el outbox: MAX(aggregate_version) + 1.
    query: jest.fn(async () => [{ version: versionPrevia }]),
  };

  const service = new SupportSlaService(sequelize as never, timeline as never, cases as never, catalog as never, events as never);
  return { service, timeline, cases, events, sequelize, actualizaciones, eventosDeCaso, publicados };
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
  it('un reloj que otro barrido o el agente ya cerró no se repite ni se sobrescribe', async () => {
    const { service, timeline, eventosDeCaso, publicados } = montar([
      { id: '9', caseId: '10', metricType: 'RESOLUTION', targetAt: '2026-09-09T16:00:00.000Z' },
    ]);
    timeline.markClockBreached.mockResolvedValueOnce(false as never);

    const resultado = await service.sweepBreaches('1', new Date('2026-09-09T16:45:00.000Z'));

    expect(resultado.breached).toBe(0);
    expect(eventosDeCaso).toHaveLength(0);
    expect(publicados).toHaveLength(0);
  });

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

/*
 * El aviso PREVIO al incumplimiento. Hasta el 2026-09-29 sólo se escribía SLA_WARNING en la línea de
 * tiempo del caso y `support.sla.warning` —registrado en el catálogo de eventos— no lo publicaba nadie:
 * el aviso "a tiempo" no le llegaba a persona alguna. Lo que se fija aquí es que cada umbral cruzado
 * sale al outbox, con versión de agregado e idempotencia, y que un fallo del outbox se reintenta.
 */
describe('SupportSlaService · aviso previo al incumplimiento', () => {
  const inicio = '2026-09-09T12:00:00.000Z';
  const objetivo = '2026-09-09T14:00:00.000Z'; // 120 min
  const reloj = (over: Reloj = {}): Reloj => ({
    id: '9',
    caseId: '10',
    metricType: 'RESOLUTION',
    policyVersionId: '7',
    startedAt: inicio,
    targetAt: objetivo,
    warnedPercentsJson: [],
    ...over,
  });

  it('publica support.sla.warning con versión de agregado, idempotencia y el umbral, y lo anota en el reloj y en el caso', async () => {
    const { service, publicados, actualizaciones, eventosDeCaso } = montar([reloj()], [50, 75, 90], '4');

    // 12:00 + 96 min = 80 % del plazo: cruza el 50 y el 75, no el 90.
    const resultado = await service.sweepWarnings('1', new Date('2026-09-09T13:36:00.000Z'));

    expect(resultado.warned).toBe(1);
    expect(publicados).toHaveLength(1);
    expect(publicados[0]).toMatchObject({
      tenantId: '1',
      eventCode: 'support.sla.warning',
      aggregateType: 'support_case',
      aggregateId: '10',
      aggregateVersion: 5,
      idempotencyKey: 'support-sla-warning-9-75',
      sourceModule: 'support',
      sourceAction: 'sweep_sla_warnings',
      payload: { caseId: '10', metricType: 'RESOLUTION', reachedPercents: [50, 75], minutesRemaining: 24 },
    });
    expect(actualizaciones[0][1]).toEqual({ warnedPercentsJson: [50, 75] });
    expect(eventosDeCaso[0].eventType).toBe('SLA_WARNING');
  });

  it('la primera vez la versión del agregado es 1', async () => {
    const { service, publicados } = montar([reloj()], [50], null);
    await service.sweepWarnings('1', new Date('2026-09-09T13:10:00.000Z'));
    expect(publicados[0].aggregateVersion).toBe(1);
  });

  /* En negativo: sin umbral nuevo cruzado, o sin política, no hay evento (no se repite el aviso cada minuto). */
  it('no publica nada si el umbral ya se avisó, si aún no se cruza ninguno o si la política no tiene umbrales', async () => {
    const yaAvisado = montar([reloj({ warnedPercentsJson: [50, 75] })], [50, 75, 90]);
    await yaAvisado.service.sweepWarnings('1', new Date('2026-09-09T13:36:00.000Z'));
    const temprano = montar([reloj()], [50, 75, 90]);
    await temprano.service.sweepWarnings('1', new Date('2026-09-09T12:30:00.000Z'));
    const sinUmbrales = montar([reloj()], []);
    await sinUmbrales.service.sweepWarnings('1', new Date('2026-09-09T13:36:00.000Z'));

    expect(yaAvisado.publicados).toHaveLength(0);
    expect(temprano.publicados).toHaveLength(0);
    expect(sinUmbrales.publicados).toHaveLength(0);
  });

  /*
   * Si el outbox falla, el umbral NO se anota: la pasada siguiente lo reintenta. Anotarlo y perder el
   * evento sería el mismo aviso que no llega a nadie, esta vez sin ni siquiera intentarlo de nuevo.
   */
  it('si el outbox falla no anota el umbral ni el caso, y no tumba el barrido: el reintento lo publica', async () => {
    const { service, events, actualizaciones, eventosDeCaso, publicados } = montar([reloj(), reloj({ id: '11', caseId: '12' })], [50]);
    events.publish.mockRejectedValueOnce(new Error('outbox caído') as never);
    const ahora = new Date('2026-09-09T13:10:00.000Z');

    const primera = await service.sweepWarnings('1', ahora);

    expect(primera.warned).toBe(1); // el segundo reloj sí avanzó
    expect(actualizaciones.map(([id]) => id)).toEqual(['11']);
    expect(eventosDeCaso).toHaveLength(1);

    const segunda = await service.sweepWarnings('1', ahora);
    expect(segunda.warned).toBe(2);
    expect(publicados.map((p) => p.idempotencyKey)).toEqual([
      'support-sla-warning-11-50',
      'support-sla-warning-9-50',
      'support-sla-warning-11-50',
    ]);
  });

  it('el incumplimiento también lleva versión de agregado', async () => {
    const { service, publicados } = montar(
      [{ id: '9', caseId: '10', metricType: 'RESOLUTION', targetAt: '2026-09-09T16:00:00.000Z' }],
      [],
      '2',
    );
    await service.sweepBreaches('1', new Date('2026-09-09T16:45:00.000Z'));
    expect(publicados[0]).toMatchObject({
      eventCode: 'support.sla.breached',
      aggregateVersion: 3,
      idempotencyKey: 'support-sla-breach-9',
    });
  });
});
