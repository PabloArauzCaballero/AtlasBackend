import { describe, expect, it } from '@jest/globals';

import {
  calcularSeñalesDelTelefono,
  type EntradasDeSeñalesDelTelefono,
  type PingObservado,
} from '../../../src/modules/decision-engine/device-risk-features.js';

const sinNada: EntradasDeSeñalesDelTelefono = {
  pings: [],
  snapshots: [],
  sharedDeviceCustomers: 0,
  comportamiento: null,
  agenda: { available: false, totalContacts: 0, watchlistMatches: 0, ringCustomers: 0 },
};

/** Una posición a una hora UTC dada del 2026-10-01. Bolivia = UTC−4, así que 03:00 UTC son las 23:00 locales. */
const ping = (horaUtc: number, distancia: number | null, extra: Partial<PingObservado> = {}): PingObservado => ({
  capturedAt: new Date(Date.UTC(2026, 9, 1, horaUtc, 0, 0)),
  captureMode: 'background',
  isMocked: false,
  distanceToDeclaredMeters: distancia,
  ...extra,
});

describe('calcularSeñalesDelTelefono', () => {
  it('sin materia prima todo viaja ausente, nunca «limpio»', () => {
    const s = calcularSeñalesDelTelefono(sinNada);
    expect(s.geo.available).toBe(false);
    expect(s.device.available).toBe(false);
    expect(s.behavior.available).toBe(false);
    expect(Object.values(s.variables).every((v) => v.available === false)).toBe(true);
  });

  it('una posición simulada es un hecho aunque haya pocas posiciones', () => {
    const s = calcularSeñalesDelTelefono({ ...sinNada, pings: [ping(15, 10, { isMocked: true })] });
    expect(s.variables.geolocation_mismatch_flag).toEqual({ value: true, available: true });
    expect(s.device.riskScore).toBe(30);
  });

  it('pocas posiciones sin simulación no afirman que la ubicación sea real', () => {
    const s = calcularSeñalesDelTelefono({ ...sinNada, pings: [ping(15, 10), ping(16, 20)] });
    expect(s.variables.geolocation_mismatch_flag).toEqual({ value: false, available: false });
  });

  it('la noche se mide en hora de Bolivia y el «en casa» con el radio declarado', () => {
    // 03:00 UTC = 23:00 BOT (noche), 15:00 UTC = 11:00 BOT (día).
    const pings = [ping(3, 50), ping(4, 120), ping(5, 2_000), ping(15, 9_000)];
    const s = calcularSeñalesDelTelefono({ ...sinNada, pings });
    expect(s.geo.nightPings).toBe(3);
    expect(s.geo.nightAtHomeRatio).toBe(0.667);
    expect(s.geo.homeDistanceP50Meters).toBe(1_060);
    expect(s.geo.coverageHours).toBe(4);
  });

  it('suma el riesgo del dispositivo y lo acota a 100', () => {
    const s = calcularSeñalesDelTelefono({
      ...sinNada,
      pings: [ping(15, 10, { isMocked: true })],
      snapshots: [{ isRooted: true, isEmulator: true }],
      sharedDeviceCustomers: 3,
    });
    expect(s.device.rootedOrEmulator).toBe(true);
    expect(s.device.riskScore).toBe(100);
  });

  it('el corte de automatización es inclusivo y sin resumen no hay veredicto', () => {
    expect(
      calcularSeñalesDelTelefono({ ...sinNada, comportamiento: { botLikelihoodScore: 0.7 } }).variables.browser_automation_detected,
    ).toEqual({
      value: true,
      available: true,
    });
    expect(
      calcularSeñalesDelTelefono({ ...sinNada, comportamiento: { botLikelihoodScore: null } }).variables.browser_automation_detected,
    ).toEqual({
      value: false,
      available: false,
    });
  });

  it('la agenda viaja como contexto y NO se convierte en fraude del solicitante', () => {
    const s = calcularSeñalesDelTelefono({
      ...sinNada,
      agenda: { available: true, totalContacts: 300, watchlistMatches: 2, ringCustomers: 1 },
    });
    expect(s.contacts.watchlistMatches).toBe(2);
    expect(s.variables).not.toHaveProperty('known_fraud_phone_flag');
  });
});
