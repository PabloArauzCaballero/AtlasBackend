import { describe, expect, it, afterEach } from '@jest/globals';
import { ForbiddenException } from '@nestjs/common';
import {
  consentPurposeCodes,
  envBoolean,
  envNumber,
  envValue,
  featuresFromObservations,
  isConsentRequiredError,
  isMockMode,
  mockBaseUrlFor,
  mockDataAllowedInProduction,
  MOCK_MODES,
  payloadHash,
  percentile,
  policyNumber,
  productionIntegrationBlockers,
  providerModeFromEnv,
  round2,
  statusFromRaw,
  toMode,
  toProviderCode,
} from '../../../src/modules/external-data/application/external-data-policy.util.js';

/**
 * `external-data-policy.util` (Fase 1.2 — branch coverage): util puro y muy denso en ramas
 * (normalización de proveedor/modo, lectura de env, gate de producción, derivación de estado y de
 * features). Las funciones que leen `process.env` se ejercitan seteando y restaurando las claves.
 */
describe('external-data-policy.util', () => {
  const touched: string[] = [];
  const setEnv = (key: string, value: string) => {
    touched.push(key);
    process.env[key] = value;
  };
  afterEach(() => {
    for (const key of touched.splice(0)) delete process.env[key];
  });

  it('toProviderCode normaliza y mapea el alias CGIP -> SEGIP', () => {
    expect(toProviderCode('  segip ')).toBe('SEGIP');
    expect(toProviderCode('cgip')).toBe('SEGIP');
    expect(toProviderCode('INFOCENTER')).toBe('INFOCENTER');
  });

  it('toMode acepta los modos válidos y cae a mock_local ante nulo/desconocido', () => {
    for (const mode of ['mock_local', 'mock_server', 'sandbox', 'production', 'disabled']) {
      expect(toMode(mode.toUpperCase())).toBe(mode);
    }
    expect(toMode(null)).toBe('mock_local');
    expect(toMode(undefined)).toBe('mock_local');
    expect(toMode('what')).toBe('mock_local');
  });

  it('envValue devuelve undefined para ausente/vacío y recorta el resto', () => {
    expect(envValue('ATLAS_TEST_MISSING_KEY')).toBeUndefined();
    setEnv('ATLAS_TEST_EMPTY', '   ');
    expect(envValue('ATLAS_TEST_EMPTY')).toBeUndefined();
    setEnv('ATLAS_TEST_VAL', '  hola  ');
    expect(envValue('ATLAS_TEST_VAL')).toBe('hola');
  });

  it('providerModeFromEnv prioriza <CODE>_MODE sobre el fallback', () => {
    expect(providerModeFromEnv('SEGIP', 'sandbox')).toBe('sandbox');
    setEnv('SEGIP_MODE', 'production');
    expect(providerModeFromEnv('SEGIP', 'sandbox')).toBe('production');
  });

  it('mockBaseUrlFor: url explícita > base+path conocido > base+path derivado', () => {
    setEnv('SEGIP_MOCK_BASE_URL', 'http://explicit');
    expect(mockBaseUrlFor('SEGIP')).toBe('http://explicit');

    expect(mockBaseUrlFor('INFOCENTER')).toBe('http://localhost:4010/mock/infocenter');
    expect(mockBaseUrlFor('UNKNOWN_PROVIDER')).toBe('http://localhost:4010/mock/unknown_provider');

    setEnv('EXTERNAL_PROVIDERS_MOCK_BASE_URL', 'http://mocks');
    expect(mockBaseUrlFor('TELCO_GENERIC')).toBe('http://mocks/telco');
  });

  it('envBoolean respeta el default y reconoce 1/true/yes/on', () => {
    expect(envBoolean('ATLAS_TEST_BOOL', true)).toBe(true);
    expect(envBoolean('ATLAS_TEST_BOOL', false)).toBe(false);
    for (const truthy of ['1', 'true', 'YES', 'on']) {
      process.env.ATLAS_TEST_BOOL = truthy;
      touched.push('ATLAS_TEST_BOOL');
      expect(envBoolean('ATLAS_TEST_BOOL', false)).toBe(true);
    }
    process.env.ATLAS_TEST_BOOL = 'nope';
    expect(envBoolean('ATLAS_TEST_BOOL', true)).toBe(false);
  });

  it('envNumber usa el default ante ausente/negativo/no numérico', () => {
    expect(envNumber('ATLAS_TEST_NUM', 7)).toBe(7);
    setEnv('ATLAS_TEST_NUM', '12');
    expect(envNumber('ATLAS_TEST_NUM', 7)).toBe(12);
    process.env.ATLAS_TEST_NUM = '-1';
    expect(envNumber('ATLAS_TEST_NUM', 7)).toBe(7);
    process.env.ATLAS_TEST_NUM = 'abc';
    expect(envNumber('ATLAS_TEST_NUM', 7)).toBe(7);
  });

  describe('productionIntegrationBlockers', () => {
    it('fuera de production no bloquea nada', () => {
      expect(productionIntegrationBlockers('SEGIP', 'mock_local')).toEqual([]);
      expect(productionIntegrationBlockers('SEGIP', 'sandbox')).toEqual([]);
    });

    it('en production reporta integración no implementada + credenciales faltantes', () => {
      const blockers = productionIntegrationBlockers('SEGIP', 'production');
      expect(blockers).toContain('SEGIP_REAL_INTEGRATION_NOT_IMPLEMENTED');
      expect(blockers).toContain('SEGIP_CLIENT_SECRET_MISSING');
    });

    it('con integración implementada y credenciales presentes solo queda el flag de mock permitido', () => {
      setEnv('SEGIP_REAL_INTEGRATION_IMPLEMENTED', 'true');
      setEnv('SEGIP_BASE_URL', 'https://segip');
      setEnv('SEGIP_CLIENT_ID', 'id');
      setEnv('SEGIP_CLIENT_SECRET', 'secret');
      expect(productionIntegrationBlockers('SEGIP', 'production')).toEqual([]);
      setEnv('SEGIP_ALLOW_MOCK_IN_PROD', 'true');
      expect(productionIntegrationBlockers('SEGIP', 'production')).toEqual(['SEGIP_MOCK_ALLOWED_IN_PRODUCTION']);
    });

    it('un proveedor sin requisitos registrados exige su <CODE>_BASE_URL', () => {
      setEnv('OTRO_REAL_INTEGRATION_IMPLEMENTED', 'true');
      expect(productionIntegrationBlockers('OTRO', 'production')).toEqual(['OTRO_BASE_URL_MISSING']);
    });
  });

  /**
   * Hallazgo A-02 de docs/audit/auditoria-integral-2026-07-30.md: los nueve proveedores se siembran
   * con `default_mode = 'mock_local'` y `toMode` también cae ahí, así que un despliegue productivo
   * que no fije `${CODE}_MODE=production` servía evidencia KYC INVENTADA y la persistía como
   * features del cliente. Estas pruebas fijan que en producción eso queda bloqueado.
   */
  describe('modo simulado en producción', () => {
    const originalNodeEnv = process.env.NODE_ENV;
    const runAsProduction = (assertions: () => void) => {
      process.env.NODE_ENV = 'production';
      try {
        assertions();
      } finally {
        process.env.NODE_ENV = originalNodeEnv;
      }
    };

    it('isMockMode distingue los modos que no hablan con el proveedor real', () => {
      expect(MOCK_MODES).toEqual(['mock_local', 'mock_server']);
      expect(isMockMode('mock_local')).toBe(true);
      expect(isMockMode('mock_server')).toBe(true);
      expect(isMockMode('production')).toBe(false);
      expect(isMockMode('sandbox')).toBe(false);
      expect(isMockMode('disabled')).toBe(false);
    });

    it('en producción bloquea mock_local y mock_server, y no toca sandbox ni disabled', () => {
      runAsProduction(() => {
        expect(productionIntegrationBlockers('SEGIP', 'mock_local')).toEqual(['SEGIP_MOCK_MODE_IN_PRODUCTION']);
        expect(productionIntegrationBlockers('INFOCENTER', 'mock_server')).toEqual(['INFOCENTER_MOCK_MODE_IN_PRODUCTION']);
        expect(productionIntegrationBlockers('SEGIP', 'sandbox')).toEqual([]);
        expect(productionIntegrationBlockers('SEGIP', 'disabled')).toEqual([]);
      });
    });

    it('el alias CGIP se normaliza a SEGIP también en el bloqueo', () => {
      runAsProduction(() => {
        expect(productionIntegrationBlockers('CGIP', 'mock_local')).toEqual(['SEGIP_MOCK_MODE_IN_PRODUCTION']);
      });
    });

    it('fuera de producción el modo simulado es legítimo y no bloquea', () => {
      expect(productionIntegrationBlockers('SEGIP', 'mock_local')).toEqual([]);
      expect(productionIntegrationBlockers('SEGIP', 'mock_server')).toEqual([]);
    });

    it('el escape hatch explícito desbloquea, y solo él', () => {
      runAsProduction(() => {
        expect(mockDataAllowedInProduction()).toBe(false);
        setEnv('EXTERNAL_PROVIDERS_ALLOW_MOCK_IN_PRODUCTION', 'true');
        expect(mockDataAllowedInProduction()).toBe(true);
        expect(productionIntegrationBlockers('SEGIP', 'mock_local')).toEqual([]);
      });
    });

    it('mockBaseUrlFor no inventa un localhost en producción', () => {
      runAsProduction(() => {
        expect(mockBaseUrlFor('SEGIP')).toBeUndefined();
        setEnv('EXTERNAL_PROVIDERS_MOCK_BASE_URL', 'https://mocks.interno');
        expect(mockBaseUrlFor('SEGIP')).toBe('https://mocks.interno/segip');
      });
    });
  });

  it('percentile devuelve null si no hay valores y el índice acotado si los hay', () => {
    expect(percentile([], 95)).toBeNull();
    expect(percentile([10], 50)).toBe(10);
    expect(percentile([30, 10, 20], 50)).toBe(20);
    expect(percentile([30, 10, 20], 100)).toBe(30);
    expect(percentile([30, 10, 20], 0)).toBe(10);
  });

  it('round2 redondea a 2 decimales (Math.round(v*100)/100)', () => {
    expect(round2(1.567)).toBe(1.57);
    expect(round2(1.564)).toBe(1.56);
    expect(round2(2)).toBe(2);
    // Artefacto conocido de coma flotante: 1.005*100 === 100.49999999999999, así que redondea a 1.
    expect(round2(1.005)).toBe(1);
  });

  it('policyNumber cae al default ante null/undefined/negativo/no numérico', () => {
    expect(policyNumber(null, 5)).toBe(5);
    expect(policyNumber(undefined, 5)).toBe(5);
    expect(policyNumber(-2, 5)).toBe(5);
    expect(policyNumber('abc', 5)).toBe(5);
    expect(policyNumber('9', 5)).toBe(9);
    expect(policyNumber(0, 5)).toBe(0);
  });

  it('isConsentRequiredError reconoce el Forbidden y el mensaje CONSENT_REQUIRED', () => {
    expect(isConsentRequiredError(new ForbiddenException('CONSENT_REQUIRED'))).toBe(true);
    expect(isConsentRequiredError(new Error('algo CONSENT_REQUIRED algo'))).toBe(true);
    expect(isConsentRequiredError(new Error('otra cosa'))).toBe(false);
    expect(isConsentRequiredError('texto')).toBe(false);
  });

  it('consentPurposeCodes deriva las variantes del propósito y del proveedor', () => {
    const codes = consentPurposeCodes('SEGIP', 'Origination');
    expect(codes).toEqual(
      expect.arrayContaining([
        'Origination',
        'origination',
        'risk_fraud_assessment',
        'external_data',
        'external_origination',
        'segip_origination',
      ]),
    );
  });

  describe('statusFromRaw', () => {
    it.each([
      [{ statusCode: 401, status: 'X' }, 'PROVIDER_AUTH_FAILED'],
      [{ statusCode: 403, status: 'X' }, 'PROVIDER_AUTH_FAILED'],
      [{ status: 'UNAUTHORIZED' }, 'PROVIDER_AUTH_FAILED'],
      [{ statusCode: 429, status: 'X' }, 'RATE_LIMITED'],
      [{ status: 'RATE_LIMITED' }, 'RATE_LIMITED'],
      [{ statusCode: 503, status: 'X' }, 'PROVIDER_UNAVAILABLE'],
      [{ status: 'BLOCKED_BY_COST_POLICY' }, 'BLOCKED_BY_COST_POLICY'],
      [{ status: 'DATA_NOT_AVAILABLE' }, 'DATA_NOT_AVAILABLE'],
      [{ status: 'SEGIP_TIMEOUT' }, 'PROVIDER_UNAVAILABLE'],
      [{ status: 'FOUND', isMocked: true }, 'MOCKED'],
      [{ status: 'FOUND' }, 'COMPLETED'],
    ])('%o -> %s', (raw, expected) => {
      expect(statusFromRaw(raw as never)).toBe(expected);
    });
  });

  it('featuresFromObservations mapea cada valueType y agrega la confianza', () => {
    const features = featuresFromObservations([
      { featureKey: 'b', valueType: 'BOOLEAN', valueBoolean: true, confidenceScore: 0.9 },
      { featureKey: 'n', valueType: 'NUMBER', valueNumber: 5 },
      { featureKey: 's', valueType: 'STRING', valueString: 'x' },
      { featureKey: 'd', valueType: 'DATE', valueDate: '2026-01-01' },
      { featureKey: 'j', valueType: 'JSON', valueJson: { a: 1 } },
      { featureKey: 'nullish', valueType: 'BOOLEAN' },
    ] as never);
    expect(features).toMatchObject({
      b: true,
      b__confidence: 0.9,
      n: 5,
      s: 'x',
      d: '2026-01-01',
      j: { a: 1 },
      nullish: null,
      nullish__confidence: null,
    });
  });

  it('payloadHash es estable ante el orden de claves', () => {
    expect(payloadHash({ a: 1, b: 2 })).toBe(payloadHash({ b: 2, a: 1 }));
    expect(payloadHash({ a: 1 })).not.toBe(payloadHash({ a: 2 }));
  });
});
