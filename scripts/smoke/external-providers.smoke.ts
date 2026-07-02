import { CUSTOMER_ID, request, uniqueKey } from './http.js';

export async function runExternalProvidersSmoke(): Promise<void> {
  await request({ method: 'GET', path: '/admin/external-providers', role: 'admin' });
  await request({ method: 'GET', path: '/admin/external-providers/health', role: 'admin' });

  await request({
    method: 'POST',
    path: '/external-data/consents',
    role: 'customer',
    body: {
      customerId: CUSTOMER_ID,
      providerCode: 'SEGIP',
      purpose: 'KYC_ONBOARDING',
      legalTextVersion: 'v1-dev',
      accepted: true,
      channel: 'mobile_app',
    },
  });

  await request({
    method: 'POST',
    path: '/kyc/segip/verify',
    role: 'customer',
    idempotencyKey: uniqueKey('segip-smoke'),
    body: {
      customerId: CUSTOMER_ID,
      documentNumber: '1234567',
      documentExtension: 'SC',
      firstName: 'Cliente',
      lastName: 'Demo',
      birthDate: '1996-01-01',
      scenario: 'happy_path',
    },
  });

  await request({
    method: 'POST',
    path: '/bureau/infocenter/check',
    role: 'admin',
    idempotencyKey: uniqueKey('infocenter-blocked-smoke'),
    body: {
      customerId: CUSTOMER_ID,
      documentNumber: '1234567',
      decisionStage: 'ONBOARDING',
      scenario: 'happy_path',
    },
  });
}

if (process.argv[1]?.endsWith('external-providers.smoke.ts') || process.argv[1]?.endsWith('external-providers.smoke.js')) {
  void runExternalProvidersSmoke().catch((error) => {
    console.error('[FAIL] External providers smoke falló');
    console.error(error);
    process.exitCode = 1;
  });
}
