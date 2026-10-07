/**
 * @file Verifica las lecturas con las que los registros propios de fraude llegan a la decisión de crédito.
 * @business «Teléfono de fraude conocido» tiene que salir de un cotejo real, y una lectura caída no puede tumbar una solicitud.
 * @system Ejercita `UnderwritingTrustSignalsService.signalsFor` con modelos simulados.
 */
import { describe, expect, it, jest } from '@jest/globals';
import { UnderwritingTrustSignalsService } from '../../../src/modules/decision-engine/underwriting-trust-signals.service.js';

const NOW = new Date('2026-10-07T12:00:00Z');

type Filas = { dispositivos?: unknown[]; ips?: unknown[] };

function build(over: Record<string, unknown> = {}, filas: Filas = {}) {
  // El SQL directo: devuelve las filas según la tabla que se consulta.
  const query = jest.fn(async (sql: unknown) =>
    String(sql).includes('ip_reputation_observations') ? (filas.ips ?? []) : (filas.dispositivos ?? []),
  );
  const m = {
    customers: { findOne: jest.fn(async (..._a: unknown[]) => ({ primaryPhoneHash: 'hp', primaryEmailHash: 'he' })) },
    watchlist: { count: jest.fn(async (..._a: unknown[]) => 0) },
    fraudCases: {
      count: jest.fn(async (..._a: unknown[]) => 0),
      findAll: jest.fn(async (..._a: unknown[]) => [] as unknown[]),
    },
    links: { findAll: jest.fn(async (..._a: unknown[]) => [] as unknown[]), sequelize: { query } },
    ...over,
  };
  const service = new UnderwritingTrustSignalsService(m.customers as never, m.watchlist as never, m.fraudCases as never, m.links as never);
  return { service, m };
}

describe('UnderwritingTrustSignalsService.signalsFor', () => {
  it('sin ningún hallazgo coteja teléfono y correo, y deja sin afirmar lo que no tuvo con qué cotejar', async () => {
    const { service } = build();
    const señales = await service.signalsFor('1', 'c1', NOW);
    expect(señales?.variables.known_fraud_phone_flag).toMatchObject({ value: false, available: true });
    expect(señales?.variables.previous_fraud_case_flag).toMatchObject({ value: false, available: true });
    expect(señales?.variables.known_fraud_device_flag?.available).toBe(false);
    expect(señales?.variables.ip_address_risk_score?.available).toBe(false);
  });

  it('un teléfono o correo en la lista negra vigente, o un caso cerrado con culpa, se afirman', async () => {
    const { service, m } = build({
      watchlist: { count: jest.fn(async (..._a: unknown[]) => 1) },
      fraudCases: { count: jest.fn(async (..._a: unknown[]) => 2), findAll: jest.fn(async (..._a: unknown[]) => []) },
    });
    const señales = await service.signalsFor('1', 'c1', NOW);
    expect(señales?.variables.known_fraud_phone_flag?.value).toBe(true);
    expect(señales?.variables.known_fraud_email_flag?.value).toBe(true);
    expect(señales?.variables.previous_fraud_case_flag?.value).toBe(true);
    // Las listas globales (tenant nulo) y las vigentes: la consulta lo pide.
    expect(JSON.stringify(m.watchlist.count.mock.calls[0])).toContain('status');
  });

  it('un cliente sin teléfono ni correo no se afirma limpio', async () => {
    const { service } = build({
      customers: { findOne: jest.fn(async (..._a: unknown[]) => ({ primaryPhoneHash: null, primaryEmailHash: null })) },
    });
    const señales = await service.signalsFor('1', 'c1', NOW);
    expect(señales?.variables.known_fraud_phone_flag?.available).toBe(false);
    expect(señales?.variables.known_fraud_email_flag?.available).toBe(false);
  });

  it('un dispositivo compartido con quien tiene fraude confirmado, o bloqueado en la base global, es fraude conocido', async () => {
    const links = {
      findAll: jest
        .fn<(...a: unknown[]) => Promise<unknown[]>>()
        .mockResolvedValueOnce([{ deviceId: '5' }, { deviceId: null }])
        .mockResolvedValueOnce([{ deviceId: '5', customerId: '99' }]),
      sequelize: { query: jest.fn(async () => [{ id: '5', risk_status: 'unknown', global_risk_status: 'blocked' }]) },
    };
    const { service } = build({
      links,
      fraudCases: { count: jest.fn(async (..._a: unknown[]) => 0), findAll: jest.fn(async (..._a: unknown[]) => [{ customerId: '99' }]) },
    });
    const señales = await service.signalsFor('1', 'c1', NOW);
    expect(señales?.variables.known_fraud_device_flag).toMatchObject({ value: true, available: true });
    expect(señales?.variables.device_reputation?.value).toBe('BLOCKLISTED');
  });

  it('lee las observaciones de IP del cliente', async () => {
    const { service } = build({}, { ips: [{ is_vpn: false, is_proxy: false, is_tor: true, reputation_score: '0.2000' }] });
    const señales = await service.signalsFor('1', 'c1', NOW);
    expect(señales?.variables.ip_tor_detected?.value).toBe(true);
    expect(señales?.variables.ip_address_risk_score?.value).toBe(90);
  });

  it('una lectura caída devuelve null —ausente—, nunca «limpio» ni una excepción', async () => {
    const { service } = build({ customers: { findOne: jest.fn(async () => Promise.reject(new Error('relation does not exist'))) } });
    await expect(service.signalsFor('1', 'c1', NOW)).resolves.toBeNull();
  });
});
