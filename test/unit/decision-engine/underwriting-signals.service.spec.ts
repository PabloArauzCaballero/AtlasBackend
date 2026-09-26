/**
 * @file Verifica de dónde salen las señales de identidad que se le mandan al Motor de crédito.
 * @business Un cliente verificado por el canal móvil tiene que llegar al Motor como verificado, con biometría real.
 * @system Ejercita `UnderwritingSignalsService.identitySignals` contra distintos casings y secuencias de intentos y,
 *   con los servicios reales encadenados, el payload que arma `UnderwritingFeaturesService.build`.
 */
import { describe, expect, it, jest } from '@jest/globals';
import { UnderwritingCreditHistoryService } from '../../../src/modules/decision-engine/underwriting-credit-history.service.js';
import { UnderwritingFeaturesService } from '../../../src/modules/decision-engine/underwriting-features.service.js';
import { UnderwritingSignalsService } from '../../../src/modules/decision-engine/underwriting-signals.service.js';

/** Un modelo que no sabe nada del cliente: sin filas, sin conteos. */
function emptyModel() {
  return {
    findAll: jest.fn(async (..._args: unknown[]) => [] as unknown[]),
    findOne: jest.fn(async (..._args: unknown[]) => null),
    count: jest.fn(async (..._args: unknown[]) => 0),
  };
}

/**
 * Sólo el modelo de intentos de identidad importa aquí; el resto responde vacío. Se arma por posición
 * y no por nombre para no atar esta prueba a los demás modelos que el servicio vaya sumando: cada uno
 * que entre responde vacío, y `identityAttempts` sigue siendo el sexto.
 */
const IDENTITY_ATTEMPTS_POSITION = 5;

function build(findAll: (...args: unknown[]) => Promise<unknown[]>) {
  const identityAttempts = { findAll: jest.fn(findAll) };
  const models = Array.from({ length: 12 }, () => emptyModel()) as unknown[];
  models[IDENTITY_ATTEMPTS_POSITION] = identityAttempts;
  const service = new UnderwritingSignalsService(...(models as unknown as ConstructorParameters<typeof UnderwritingSignalsService>));
  return { service, identityAttempts };
}

describe('UnderwritingSignalsService.identitySignals', () => {
  it('FALLA sin el fix: un VERIFIED en mayúsculas (canal móvil) hoy se lee como no verificado (I-1)', async () => {
    const { service } = build(async () => [{ finalResult: 'VERIFIED', livenessScore: null, selfieMatchScore: null, nameMatchScore: null }]);

    const signals = await service.identitySignals('7', '10');

    // Sin desglose de puntajes, un verificado atestigua el mínimo aprobatorio (70), no cero.
    expect(signals.verified).toBe(true);
    expect(signals.matchScore).toBeGreaterThan(0);
    expect(signals.liveness).toBe(true);
  });

  it('sigue reconociendo el `verified` en minúsculas del canal directo', async () => {
    const { service } = build(async () => [{ finalResult: 'verified', livenessScore: null, selfieMatchScore: null, nameMatchScore: null }]);

    const signals = await service.identitySignals('7', '10');
    expect(signals.verified).toBe(true);
  });

  it('FALLA sin el fix: un intento posterior PENDING no tapa un verified anterior (I-2)', async () => {
    const { service } = build(async () => [
      // Más reciente primero, como llega ordenado por `_id DESC`.
      { finalResult: 'PENDING', livenessScore: null, selfieMatchScore: null, nameMatchScore: null },
      { finalResult: 'verified', livenessScore: '80.00', selfieMatchScore: '0.90', nameMatchScore: '0.85' },
    ]);

    const signals = await service.identitySignals('7', '10');

    expect(signals.verified).toBe(true);
    expect(signals.matchScore).toBe(90);
  });

  it('sin ningún intento, no afirma nada', async () => {
    const { service } = build(async () => []);
    const signals = await service.identitySignals('7', '10');
    expect(signals).toEqual({ verified: false, liveness: false, matchScore: 0, confidence: 0, inferred: false });
  });
});

describe('UnderwritingFeaturesService.build · lo que llega al Motor de un cliente verificado por el móvil', () => {
  function buildFeatures(findAll: (...args: unknown[]) => Promise<unknown[]>) {
    const { service: signals } = build(findAll);
    const history = new UnderwritingCreditHistoryService(emptyModel() as never, emptyModel() as never);
    return new UnderwritingFeaturesService(signals, history);
  }

  const request = { tenantId: '7', customerId: '10', requestedAmount: 1000, requestedTermMonths: 6 };

  it('FALLA sin el fix: un VERIFIED en mayúsculas llega como kyc_status VERIFIED y con biometría real, no PENDING y en 0 (I-1)', async () => {
    // Lo que escribe el canal móvil (`mobile-identity.service`): estado en mayúsculas y el parecido de la selfie.
    const features = buildFeatures(async () => [
      { finalResult: 'VERIFIED', livenessScore: null, selfieMatchScore: '0.93', nameMatchScore: null },
    ]);

    const { variables, provenance } = await features.build(request);

    expect(variables.kyc_status).toBe('VERIFIED');
    expect(variables.national_id_verified).toBe(true);
    expect(variables.biometric_match_score).toBe(93);
    expect(provenance.biometric_match_score).toBe('expediente');
  });

  it('FALLA sin el fix: un VERIFIED del móvil sin desglose de puntajes atestigua el aprobado, no un cero', async () => {
    const features = buildFeatures(async () => [
      { finalResult: 'VERIFIED', livenessScore: null, selfieMatchScore: null, nameMatchScore: null },
    ]);

    const { variables, provenance } = await features.build(request);

    expect(variables.kyc_status).toBe('VERIFIED');
    expect(variables.liveness_check_passed).toBe(true);
    expect(variables.biometric_match_score).toBeGreaterThan(0);
    expect(provenance.biometric_match_score).toBe('derivado');
  });

  it('FALLA sin el fix: un reintento posterior PENDING no vuelve a dejar al cliente en PENDING ante el Motor (I-2)', async () => {
    const features = buildFeatures(async () => [
      { finalResult: 'PENDING', livenessScore: null, selfieMatchScore: null, nameMatchScore: null },
      { finalResult: 'VERIFIED', livenessScore: null, selfieMatchScore: '0.93', nameMatchScore: null },
    ]);

    const { variables } = await features.build(request);

    expect(variables.kyc_status).toBe('VERIFIED');
    expect(variables.biometric_match_score).toBe(93);
  });

  it('un cliente sin ningún intento sigue llegando PENDING y sin biometría', async () => {
    const { variables } = await buildFeatures(async () => []).build(request);

    expect(variables.kyc_status).toBe('PENDING');
    expect(variables.national_id_verified).toBe(false);
    expect(variables.biometric_match_score).toBe(0);
  });
});
