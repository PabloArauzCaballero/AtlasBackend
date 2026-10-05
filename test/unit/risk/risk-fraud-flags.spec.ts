/**
 * @file Verifica las banderas de fraude del alta y que SÓLO deriven a una persona.
 * @business Hacer muy improbable que un bot o un alta fabricada siga adelante sola, sin dejar fuera a nadie legítimo.
 * @system Ejercita `evaluarBanderasDeFraude` y su efecto en `computeHeuristicScores` (funciones puras).
 */
import { describe, expect, it } from '@jest/globals';
import {
  SIN_HECHOS_DE_FRAUDE,
  evaluarBanderasDeFraude,
  type RiskFraudFacts,
} from '../../../src/modules/risk/application/risk-fraud-flags.js';
import { fraudFactFeatures, toPolicyFeatures } from '../../../src/modules/risk/application/risk-policy-features.js';
import { computeHeuristicScores } from '../../../src/modules/risk/application/risk-heuristic-scoring.js';
import { RISK_APPROVAL_MIN_SCORE } from '../../../src/modules/risk/risk-heuristic-v0.constants.js';

const con = (extra: Partial<RiskFraudFacts>): RiskFraudFacts => ({ ...SIN_HECHOS_DE_FRAUDE, ...extra });
const MEJOR_CASO = { hasIdentity: true, verifiedContactCount: 1, hasDevice: true, behaviorBotScore: 0 };

describe('evaluarBanderasDeFraude', () => {
  it('sin hechos no hay banderas', () => {
    expect(evaluarBanderasDeFraude(SIN_HECHOS_DE_FRAUDE)).toEqual({ strong: [], medium: [], context: [], escalate: false });
  });

  it.each([
    ['EMULADOR', con({ emulator: true })],
    ['UBICACION_SIMULADA', con({ mockedLocationPings: 1 })],
    ['DISPOSITIVO_EN_VARIAS_CUENTAS', con({ sharedDeviceCustomers: 2 })],
    ['RAFAGA_DE_ALTAS_DESDE_LA_IP', con({ sameIpCustomers24h: 8 })],
    ['ALTA_DESDE_VARIOS_DISPOSITIVOS', con({ sessionDevices: 3 })],
    ['COMPORTAMIENTO_AUTOMATIZADO', con({ botScore: 0.7 })],
    ['TOQUES_SOBREHUMANOS', con({ rhythmSignals: ['TOQUES_SOBREHUMANOS'] })],
    ['CAPTURA_INSTANTANEA', con({ rhythmSignals: ['CAPTURA_INSTANTANEA'] })],
  ])('una bandera fuerte basta: %s', (codigo, hechos) => {
    const banderas = evaluarBanderasDeFraude(hechos);
    expect(banderas.strong).toEqual([codigo]);
    expect(banderas.escalate).toBe(true);
  });

  it.each([
    ['DISPOSITIVO_CON_ROOT', con({ rooted: true })],
    ['DISPOSITIVO_COMPARTIDO', con({ sharedDeviceCustomers: 1 })],
    ['VARIAS_ALTAS_DESDE_LA_IP', con({ sameIpCustomers24h: 4 })],
    ['RITMO_UNIFORME_EN_CAMPOS', con({ rhythmSignals: ['RITMO_UNIFORME_EN_CAMPOS'] })],
    ['AGENDA_MINIMA', con({ contactSignals: ['AGENDA_MINIMA'] })],
  ])('una sola bandera media NO deriva: %s', (codigo, hechos) => {
    const banderas = evaluarBanderasDeFraude(hechos);
    expect(banderas.medium).toEqual([codigo]);
    expect(banderas.escalate).toBe(false);
  });

  it('dos medias sí derivan', () => {
    expect(evaluarBanderasDeFraude(con({ rooted: true, contactSignals: ['AGENDA_MINIMA'] })).escalate).toBe(true);
  });

  it('la IP de la operadora (pocas cuentas) no es una ráfaga, y la madrugada es sólo contexto', () => {
    expect(evaluarBanderasDeFraude(con({ sameIpCustomers24h: 3 })).escalate).toBe(false);
    const madrugada = evaluarBanderasDeFraude(con({ rhythmSignals: ['ALTA_DE_MADRUGADA'], rooted: true }));
    expect(madrugada.context).toEqual(['ALTA_DE_MADRUGADA']);
    expect(madrugada.escalate).toBe(false);
  });

  it('dos teléfonos durante el alta pasan; un emulador «no informado» no cuenta', () => {
    expect(evaluarBanderasDeFraude(con({ sessionDevices: 2, emulator: null, rooted: null })).escalate).toBe(false);
  });
});

describe('computeHeuristicScores · banderas de fraude', () => {
  it('con una bandera fuerte el alta NO alcanza el umbral aunque todo lo demás sea perfecto', () => {
    expect(computeHeuristicScores(MEJOR_CASO).totalScore).toBeGreaterThanOrEqual(RISK_APPROVAL_MIN_SCORE);
    const scores = computeHeuristicScores({ ...MEJOR_CASO, fraud: con({ emulator: true }) });
    expect(scores.totalScore).toBeLessThan(RISK_APPROVAL_MIN_SCORE);
    expect(scores.fraudFlags.strong).toEqual(['EMULADOR']);
  });

  it('las banderas nunca SUBEN un puntaje', () => {
    for (const hasIdentity of [true, false])
      for (const verifiedContactCount of [0, 1])
        for (const hasDevice of [true, false]) {
          const base = { hasIdentity, verifiedContactCount, hasDevice };
          const sin = computeHeuristicScores(base).totalScore;
          expect(computeHeuristicScores({ ...base, fraud: con({ mockedLocationPings: 3 }) }).totalScore).toBeLessThanOrEqual(sin);
          expect(computeHeuristicScores({ ...base, fraud: SIN_HECHOS_DE_FRAUDE }).totalScore).toBe(sin);
        }
  });

  it('sin lector de hechos (fraud null) puntúa como antes', () => {
    expect(computeHeuristicScores({ ...MEJOR_CASO, fraud: null }).totalScore).toBe(computeHeuristicScores(MEJOR_CASO).totalScore);
  });
});

describe('fraudFactFeatures · lo que viaja a RIESGO_ONBOARDING_CLIENTE 2.0.0', () => {
  it('manda los hechos con los nombres del artefacto y cuenta el ritmo por fuerza', () => {
    const features = fraudFactFeatures(
      con({
        emulator: false,
        rooted: true,
        mockedLocationPings: 0,
        sharedDeviceCustomers: 1,
        sameIpCustomers24h: 5,
        sessionDevices: 2,
        botScore: 0.35,
        rhythmSignals: ['TOQUES_SOBREHUMANOS', 'RITMO_UNIFORME_EN_CAMPOS', 'ALTA_DE_MADRUGADA'],
        contactSignals: ['AGENDA_MINIMA'],
        contactsAvailable: true,
        contactsTotal: 6,
        contactsDaysSinceLastNew: 4,
      }),
    );
    expect(features).toEqual({
      device_emulator: false,
      device_rooted: true,
      location_mocked_pings: 0,
      device_shared_customers: 1,
      ip_customers_24h: 5,
      session_devices: 2,
      behavior_bot_score: 0.35,
      rhythm_strong_signals: 1,
      rhythm_medium_signals: 1,
      contacts_available: true,
      contacts_total: 6,
      contacts_days_since_last_new: 4,
      contacts_signals: 1,
    });
  });

  it('lo que no se sabe NO viaja: ni «dispositivo limpio» ni «0 contactos» inventados', () => {
    const features = fraudFactFeatures(SIN_HECHOS_DE_FRAUDE);
    for (const ausente of ['device_emulator', 'device_rooted', 'behavior_bot_score', 'contacts_total', 'contacts_days_since_last_new'])
      expect(features).not.toHaveProperty(ausente);
    expect(features).toMatchObject({ contacts_available: false, location_mocked_pings: 0 });
  });

  it('sin lector de hechos no añade ninguna variable; el resto del contrato sigue igual', () => {
    expect(fraudFactFeatures(null)).toEqual({});
    const features = toPolicyFeatures({
      ...computeHeuristicScores(MEJOR_CASO),
      hasIdentity: true,
      verifiedContactCount: 1,
      hasGrantedConsent: true,
    });
    expect(features).toMatchObject({ total_score: expect.any(Number), fraud_flags_strong: 0, fraud_flags_medium: 0 });
    expect(features).not.toHaveProperty('device_emulator');
  });
});
