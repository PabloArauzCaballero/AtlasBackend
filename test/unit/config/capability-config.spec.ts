/**
 * @file AT-046 — configuración por capacidad y política de cifrado sin degradación silenciosa.
 * @business Un worker sin capacidad KYC no exige secretos KYC; una capacidad con PII y KMS requerido
 *   falla cerrado si falta KMS.
 * @system Funciones puras sobre un `source` explícito; sin `process.env`.
 */
import { describe, expect, it } from '@jest/globals';
import { CapabilityConfigError, decideEncryptionProvider, loadCapabilityConfig } from '../../../src/platform/config/capability-config.js';

describe('configuración por capacidad (AT-046)', () => {
  it('la capacidad messaging valida sus variables y no exige las de KYC ni las de crédito', () => {
    const config = loadCapabilityConfig('messaging', { NOTIFICATION_TOKEN_ENCRYPTION_KEY: 'x'.repeat(32) });
    expect(config.NOTIFICATION_TOKEN_ENCRYPTION_KEY).toHaveLength(32);
    expect(() => loadCapabilityConfig('messaging', {})).toThrow(CapabilityConfigError);
    expect(() => loadCapabilityConfig('jobs', {})).not.toThrow(); // jobs no exige secreto alguno
  });

  it('capacidad con PII y KMS requerido sin KMS: falla cerrado, no escribe con fallback local', () => {
    expect(() => decideEncryptionProvider('kyc', { NODE_ENV: 'development' })).toThrow(/KMS_REQUIRED/);
    expect(decideEncryptionProvider('kyc', { KMS_KEY_ID: 'k', AWS_REGION: 'us-east-1' })).toEqual({ provider: 'kms' });
  });

  it('en producción con ENCRYPTION_REQUIRE_KMS=true, toda capacidad con PII exige KMS; sin PII, no', () => {
    const prod = { NODE_ENV: 'production', ENCRYPTION_REQUIRE_KMS: 'true' };
    expect(() => decideEncryptionProvider('messaging', prod)).toThrow(/KMS_REQUIRED/);
    expect(decideEncryptionProvider('events', prod)).toEqual({ provider: 'local' });
  });

  it('fuera de producción, una capacidad con PII sin KMS usa local (comportamiento actual, explícito)', () => {
    expect(decideEncryptionProvider('credit', { NODE_ENV: 'development' })).toEqual({ provider: 'local' });
  });
});
