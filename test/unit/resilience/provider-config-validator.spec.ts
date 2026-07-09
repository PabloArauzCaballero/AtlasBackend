import { describe, expect, it } from '@jest/globals';
import { assertAllProvidersConfigured, assertProviderConfigured, ProviderConfigError } from '../../../src/common/resilience/provider-config-validator.js';

describe('assertProviderConfigured', () => {
  it('does nothing when all required vars are present', () => {
    expect(() =>
      assertProviderConfigured({
        providerValue: 'sendgrid',
        channelOrDomain: 'NOTIFICATION_EMAIL_PROVIDER',
        requiredEnvVars: [{ name: 'SENDGRID_API_KEY', value: 'sk_live_x' }],
      }),
    ).not.toThrow();
  });

  it('throws ProviderConfigError listing every missing var, not just the first', () => {
    try {
      assertProviderConfigured({
        providerValue: 'sendgrid',
        channelOrDomain: 'NOTIFICATION_EMAIL_PROVIDER',
        requiredEnvVars: [
          { name: 'SENDGRID_API_KEY', value: undefined },
          { name: 'SENDGRID_FROM_EMAIL', value: '' },
          { name: 'SENDGRID_FROM_NAME', value: 'Atlas' },
        ],
      });
      throw new Error('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(ProviderConfigError);
      expect((error as ProviderConfigError).missingVars).toEqual(['SENDGRID_API_KEY', 'SENDGRID_FROM_EMAIL']);
    }
  });

  it('treats a whitespace-only value as missing', () => {
    expect(() =>
      assertProviderConfigured({
        providerValue: 'twilio',
        channelOrDomain: 'NOTIFICATION_SMS_PROVIDER',
        requiredEnvVars: [{ name: 'TWILIO_AUTH_TOKEN', value: '   ' }],
      }),
    ).toThrow(ProviderConfigError);
  });
});

describe('assertAllProvidersConfigured', () => {
  it('aggregates errors from multiple providers into a single throw', () => {
    expect(() =>
      assertAllProvidersConfigured([
        { providerValue: 'sendgrid', channelOrDomain: 'email', requiredEnvVars: [{ name: 'SENDGRID_API_KEY', value: undefined }] },
        { providerValue: 'twilio', channelOrDomain: 'sms', requiredEnvVars: [{ name: 'TWILIO_AUTH_TOKEN', value: undefined }] },
      ]),
    ).toThrow(/email.*sms|sms.*email/s);
  });

  it('does not throw when every provider is fully configured', () => {
    expect(() =>
      assertAllProvidersConfigured([
        { providerValue: 'sendgrid', channelOrDomain: 'email', requiredEnvVars: [{ name: 'SENDGRID_API_KEY', value: 'x' }] },
      ]),
    ).not.toThrow();
  });
});
