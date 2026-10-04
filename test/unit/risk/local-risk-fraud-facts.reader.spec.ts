/**
 * @file Verifica que los hechos de fraude del alta salgan de lo que la base ya guarda.
 * @business La IP y el dispositivo con que la persona inició sesión, sus snapshots, su rastro, su bitácora y su agenda.
 * @system Ejercita `LocalRiskFraudFactsReader` con modelos simulados y su fallo en blando, lectura por lectura.
 */
import { describe, expect, it, jest } from '@jest/globals';
import { LocalRiskFraudFactsReader, esIpSinValor } from '../../../src/modules/risk/infrastructure/local-risk-fraud-facts.reader.js';

const NOW = new Date('2026-10-04T12:00:00Z');
const hace = (horas: number) => new Date(NOW.getTime() - horas * 3_600_000);

function build(overrides: Record<string, unknown> = {}) {
  const modelos = {
    sessions: {
      findAll: jest.fn(async (..._a: unknown[]) => [
        { ipAddress: '190.129.10.7', deviceId: '9', startedAt: hace(2) },
        { ipAddress: '10.0.1.5', deviceId: '9', startedAt: hace(3) },
        { ipAddress: '181.115.3.3', deviceId: '11', startedAt: hace(60) },
      ]),
      count: jest.fn(async (..._a: unknown[]) => 9),
    },
    links: { findAll: jest.fn(async (..._a: unknown[]) => [{ deviceId: '9' }]), count: jest.fn(async (..._a: unknown[]) => 2) },
    snapshots: { findAll: jest.fn(async (..._a: unknown[]) => [{ isRooted: false, isEmulator: true }]) },
    pings: { count: jest.fn(async (..._a: unknown[]) => 4) },
    behavior: {
      findOne: jest.fn(async (..._a: unknown[]) => ({
        botLikelihoodScore: '0.6000',
        interScreenTimingJson: { detalle: { ritmo: { senales: ['CAPTURA_INSTANTANEA', 7] } } },
      })),
    },
    contacts: {
      findAll: jest.fn(async (..._a: unknown[]) => [
        { phoneHashes: ['a'], emailCount: 0, isFavorite: false, birthday: null, contactType: 'person', createdAtValue: hace(1) },
      ]),
    },
  };
  const usados: Record<string, unknown> = { ...modelos, ...overrides };
  const reader = new LocalRiskFraudFactsReader(
    usados.sessions as never,
    usados.links as never,
    usados.snapshots as never,
    usados.pings as never,
    usados.behavior as never,
    usados.contacts as never,
  );
  return { reader, modelos };
}

describe('LocalRiskFraudFactsReader.read', () => {
  it('compone red, dispositivo, ubicación, comportamiento y agenda', async () => {
    const { reader, modelos } = build();
    const hechos = await reader.read('1', '10', NOW);

    expect(hechos).toEqual({
      emulator: true,
      rooted: false,
      mockedLocationPings: 4,
      sharedDeviceCustomers: 2,
      sameIpCustomers24h: 9,
      sessionDevices: 2,
      botScore: 0.6,
      rhythmSignals: ['CAPTURA_INSTANTANEA'],
      contactSignals: ['AGENDA_MINIMA'],
    });
    // Sólo la IP pública de las últimas 24 h entra en el cruce: ni la privada del proxy ni la de hace 60 horas.
    const [opciones] = modelos.sessions.count.mock.calls[0] as [{ where: { ipAddress: Record<symbol, string[]> } }];
    expect(Object.getOwnPropertySymbols(opciones.where.ipAddress).map((s) => opciones.where.ipAddress[s])).toEqual([['190.129.10.7']]);
  });

  it('sin IP pública reciente no cruza con nadie', async () => {
    const sessions = { findAll: jest.fn(async () => [{ ipAddress: '10.0.1.5', deviceId: '9', startedAt: hace(1) }]), count: jest.fn() };
    const { reader } = build({ sessions });
    expect((await reader.read('1', '10', NOW)).sameIpCustomers24h).toBe(0);
    expect(sessions.count).not.toHaveBeenCalled();
  });

  it('sin agenda guardada no hay señales de agenda: no compartirla no cuenta en contra', async () => {
    const { reader } = build({ contacts: { findAll: async () => [] } });
    expect((await reader.read('1', '10', NOW)).contactSignals).toEqual([]);
  });

  it('snapshots sin dato dejan emulador y root en «no se sabe»', async () => {
    const { reader } = build({ snapshots: { findAll: async () => [{ isRooted: null, isEmulator: null }] } });
    expect(await reader.read('1', '10', NOW)).toMatchObject({ emulator: null, rooted: null });
  });

  it('una lectura caída deja SU parte en blanco y las demás siguen', async () => {
    const { reader } = build({
      sessions: {
        findAll: async () => {
          throw new Error('timeout');
        },
        count: jest.fn(),
      },
    });
    const hechos = await reader.read('1', '10', NOW);
    expect(hechos).toMatchObject({ sameIpCustomers24h: 0, sessionDevices: 0, emulator: true, mockedLocationPings: 4 });
  });
});

describe('esIpSinValor', () => {
  it.each(['10.0.1.5', '192.168.1.1', '172.20.0.3', '127.0.0.1', '::1', '::ffff:10.0.0.1', '100.101.207.88', 'fd7a:115c::1', '', null])(
    'no identifica a nadie: %s',
    (ip) => expect(esIpSinValor(ip)).toBe(true),
  );
  it.each(['190.129.10.7', '181.115.3.3', '172.15.0.1', '100.63.0.1', '2800:cd0::1'])('sí cuenta: %s', (ip) =>
    expect(esIpSinValor(ip)).toBe(false),
  );
});
