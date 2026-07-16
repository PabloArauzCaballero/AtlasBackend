import { afterEach, describe, expect, it } from '@jest/globals';
import { externalProviderBootRequirements } from '../../../src/modules/external-data/application/external-data-policy.util.js';
import { assertAllProvidersConfigured } from '../../../src/common/resilience/provider-config-validator.js';

/**
 * `externalProviderBootRequirements` valida fail-fast proveedores en modo production.
 */
describe('externalProviderBootRequirements', () => {
  const ORIGINAL_ENV = { ...process.env };

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it('returns no requirements when no provider has *_MODE=production', () => {
    delete process.env.SEGIP_MODE;
    delete process.env.INFOCENTER_MODE;
    expect(externalProviderBootRequirements()).toEqual([]);
  });

  it('ignores providers in sandbox/mock_local/disabled mode — only "production" triggers a requirement', () => {
    process.env.SEGIP_MODE = 'sandbox';
    process.env.INFOCENTER_MODE = 'mock_local';
    expect(externalProviderBootRequirements()).toEqual([]);
  });

  it('lists SEGIP_CLIENT_SECRET etc. as missing when SEGIP_MODE=production and credentials are unset', () => {
    process.env.SEGIP_MODE = 'production';
    delete process.env.SEGIP_BASE_URL;
    delete process.env.SEGIP_CLIENT_ID;
    delete process.env.SEGIP_CLIENT_SECRET;

    const requirements = externalProviderBootRequirements();
    expect(requirements).toHaveLength(1);
    expect(requirements[0]).toMatchObject({ providerValue: 'production', channelOrDomain: 'SEGIP_MODE' });
    expect(requirements[0].requiredEnvVars.map((v) => v.name)).toEqual(['SEGIP_BASE_URL', 'SEGIP_CLIENT_ID', 'SEGIP_CLIENT_SECRET']);
  });

  it('assertAllProvidersConfigured throws end-to-end when SEGIP is forced to production without credentials', () => {
    process.env.SEGIP_MODE = 'production';
    delete process.env.SEGIP_BASE_URL;
    delete process.env.SEGIP_CLIENT_ID;
    delete process.env.SEGIP_CLIENT_SECRET;

    expect(() => assertAllProvidersConfigured(externalProviderBootRequirements())).toThrow(/SEGIP_MODE/);
  });

  it('does not throw when SEGIP_MODE=production and every required credential is set', () => {
    process.env.SEGIP_MODE = 'production';
    process.env.SEGIP_BASE_URL = 'https://segip.example.gov.bo';
    process.env.SEGIP_CLIENT_ID = 'client-id';
    process.env.SEGIP_CLIENT_SECRET = 'client-secret';

    expect(() => assertAllProvidersConfigured(externalProviderBootRequirements())).not.toThrow();
  });
});
