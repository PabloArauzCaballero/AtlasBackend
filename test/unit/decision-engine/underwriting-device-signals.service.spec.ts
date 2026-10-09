/**
 * @file Verifica las lecturas con las que las señales del teléfono llegan a la decisión de crédito.
 * @business Lo que se recoge del teléfono tiene que poder decidir; y una lectura caída no puede tumbar una solicitud.
 * @system Ejercita `UnderwritingDeviceSignalsService.signalsFor` con modelos simulados (plan F3).
 */
import { describe, expect, it, jest } from '@jest/globals';
import { env } from '../../../src/config/env.js';
import { variablesEnVivo } from '../../../src/modules/decision-engine/underwriting-device-signals.service.js';
import { UnderwritingDeviceSignalsService } from '../../../src/modules/decision-engine/underwriting-device-signals.service.js';

const NOW = new Date('2026-10-04T12:00:00Z');

const SI = { granted: true, revokedAt: null };
type Consentimientos = Record<string, { granted: boolean; revokedAt: Date | null } | undefined>;

function build(
  overrides: Record<string, unknown> = {},
  consentimientos: Consentimientos = { device_address_book: SI, location_tracking: SI },
) {
  const query = jest.fn(async (..._args: unknown[]) => [{ n: '2' }]);
  const modelos = {
    pings: {
      findAll: jest.fn(async (..._args: unknown[]) => [
        { capturedAt: new Date('2026-10-03T03:00:00Z'), captureMode: 'background', isMocked: true, distanceToDeclaredMeters: '120.50' },
        { capturedAt: new Date('2026-10-03T15:00:00Z'), captureMode: 'foreground', isMocked: false, distanceToDeclaredMeters: null },
      ]),
    },
    snapshots: { findAll: jest.fn(async (..._args: unknown[]) => [{ isRooted: true, isEmulator: false }]) },
    links: {
      findAll: jest.fn(async (..._args: unknown[]) => [{ deviceId: '9' }, { deviceId: '9' }, { deviceId: null }]),
      count: jest.fn(async (..._args: unknown[]) => 3),
    },
    behavior: { findOne: jest.fn(async (..._args: unknown[]) => ({ botLikelihoodScore: '0.7500' })) },
    contacts: {
      findAll: jest.fn(async (..._args: unknown[]) => [{ phoneHashes: ['a', 'b'] }, { phoneHashes: ['b', 'c'] }]),
      getTableName: () => ({ schema: 'customer', tableName: 'customer_device_contacts' }),
      sequelize: { query },
    },
    watchlist: { count: jest.fn(async (..._args: unknown[]) => 1) },
    consents: {
      findOne: jest.fn(async (opciones: unknown) => {
        const proposito = (opciones as { where: { purposeCode: string } }).where.purposeCode;
        return consentimientos[proposito] ?? null;
      }),
    },
  };
  const usados: Record<string, unknown> = { ...modelos, ...overrides };
  const service = new UnderwritingDeviceSignalsService(
    usados.pings as never,
    usados.snapshots as never,
    usados.links as never,
    usados.behavior as never,
    usados.contacts as never,
    usados.watchlist as never,
    usados.consents as never,
  );
  return { service, modelos, query };
}

describe('UnderwritingDeviceSignalsService.signalsFor', () => {
  it('compone ubicación, dispositivo, comportamiento y agenda, con el modo del entorno', async () => {
    const { service, modelos, query } = build();
    const señales = await service.signalsFor('1', '10', NOW);

    expect(señales?.mode).toBe(env.UNDERWRITING_DEVICE_SIGNALS_MODE);
    expect(señales?.geo).toMatchObject({ pingsCount: 2, backgroundPings: 1, mockedCount: 1, homeDistanceP50Meters: 121 });
    // root 40 + ubicación simulada 30 + dispositivo compartido con 3 clientes 30.
    expect(señales?.device).toMatchObject({ rootedOrEmulator: true, sharedDeviceCustomers: 3, riskScore: 100 });
    expect(señales?.behavior).toEqual({ available: true, botLikelihoodScore: 0.75 });
    expect(señales?.contacts).toMatchObject({ available: true, totalContacts: 2, watchlistMatches: 1, ringCustomers: 2 });
    // La forma de la agenda viaja con ella: cuántos contactos y cuándo apareció el último.
    expect(señales?.contacts.shape).toMatchObject({ total: 2, daysSinceLastNewContact: null, senales: ['AGENDA_MINIMA'] });

    // El cruce del anillo va por hashes únicos y contra la tabla con su esquema; nunca descifra una ficha.
    const [sql, opciones] = query.mock.calls[0] as [string, { replacements: { hashes: string[] } }];
    expect(sql).toContain('"customer"."customer_device_contacts"');
    expect(opciones.replacements.hashes).toEqual(['a', 'b', 'c']);
    expect(modelos.links.count).toHaveBeenCalledTimes(1);
  });

  it('sin agenda guardada no cruza nada y la declara no disponible', async () => {
    const { service, query, modelos } = build({
      contacts: { findAll: async () => [], getTableName: () => 'customer_device_contacts', sequelize: { query: jest.fn() } },
    });
    const señales = await service.signalsFor('1', '10', NOW);
    expect(señales?.contacts).toEqual({ available: false, totalContacts: 0, watchlistMatches: 0, ringCustomers: 0 });
    expect(query).not.toHaveBeenCalled();
    expect(modelos.watchlist.count).not.toHaveBeenCalled();
  });

  it('APP-03: la forma de la agenda lee las banderas de la captura 2.0.0', async () => {
    const query = jest.fn(async (..._args: unknown[]) => [{ n: '0' }]);
    const filas = Array.from({ length: 25 }, (_, i) => ({ phoneHashes: [`h${i}`], emailCount: 0, hasEmail: false, hasBirthday: i === 7 }));
    const findAll = jest.fn(async (..._args: unknown[]) => filas);
    const { service } = build({ contacts: { findAll, getTableName: () => 'customer_device_contacts', sequelize: { query } } });
    const señales = await service.signalsFor('1', '10', NOW);
    // Un cumpleaños marcado (sin la fecha) basta para que no sea una agenda uniforme.
    expect(señales?.contacts.shape?.senales).toEqual([]);
    expect(señales?.contacts.shape?.withBirthdayRatio).toBe(0.04);
    const [opciones] = findAll.mock.calls[0] as [{ attributes: string[] }];
    expect(opciones.attributes).toEqual(expect.arrayContaining(['hasEmail', 'hasBirthday', 'hasCompany', 'emailCount', 'birthday']));
  });

  it('sin dispositivos vinculados no cuenta compartidos', async () => {
    const links = { findAll: jest.fn(async () => []), count: jest.fn() };
    const { service } = build({ links });
    expect((await service.signalsFor('1', '10', NOW))?.device.sharedDeviceCustomers).toBe(0);
    expect(links.count).not.toHaveBeenCalled();
  });

  it('una lectura caída devuelve null en vez de tumbar la solicitud', async () => {
    const { service } = build({
      pings: {
        findAll: async () => {
          throw new Error('relation does not exist');
        },
      },
    });
    await expect(service.signalsFor('1', '10', NOW)).resolves.toBeNull();
  });
});

describe('UnderwritingDeviceSignalsService · consentimiento vigente', () => {
  it('con la agenda retirada no lee las fichas guardadas ni cruza nada', async () => {
    const { service, modelos, query } = build({}, { device_address_book: { granted: true, revokedAt: new Date() }, location_tracking: SI });
    const señales = await service.signalsFor('1', '10', NOW);
    expect(señales?.contacts).toEqual({ available: false, totalContacts: 0, watchlistMatches: 0, ringCustomers: 0 });
    expect(modelos.contacts.findAll).not.toHaveBeenCalled();
    expect(query).not.toHaveBeenCalled();
    // La ubicación, que sigue consentida, sí se lee.
    expect(señales?.geo.pingsCount).toBe(2);
  });

  it('si la ÚLTIMA decisión es un «no», la concesión anterior ya no ampara nada', async () => {
    const { service, modelos } = build({}, { device_address_book: SI, location_tracking: { granted: false, revokedAt: null } });
    const señales = await service.signalsFor('1', '10', NOW);
    expect(señales?.geo).toMatchObject({ available: false, pingsCount: 0, mockedCount: 0 });
    expect(modelos.pings.findAll).not.toHaveBeenCalled();
    expect(señales?.contacts.available).toBe(true);
  });

  it('sin ninguna decisión registrada no se lee nada del teléfono', async () => {
    const { service } = build({}, {});
    const señales = await service.signalsFor('1', '10', NOW);
    expect(señales?.geo.available).toBe(false);
    expect(señales?.contacts.available).toBe(false);
  });
});

describe('variablesEnVivo', () => {
  it('sólo en live y sólo las que tienen materia prima', async () => {
    const { service } = build();
    const señales = (await service.signalsFor('1', '10', NOW))!;
    expect(variablesEnVivo({ ...señales, mode: 'shadow' })).toEqual([]);
    expect(variablesEnVivo(null)).toEqual([]);
    expect(Object.fromEntries(variablesEnVivo({ ...señales, mode: 'live' }))).toEqual({
      geolocation_mismatch_flag: true,
      device_risk_score: 100,
      browser_automation_detected: true,
    });
  });
});
