import { CUSTOMER_ID, request, uniqueKey } from './http.js';

export async function runExternalProvidersErrorSmoke(): Promise<void> {
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
    idempotencyKey: uniqueKey('segip-partial-smoke'),
    body: {
      customerId: CUSTOMER_ID,
      documentNumber: '1234567',
      firstName: 'Nombre',
      lastName: 'Inconsistente',
      scenario: 'partial_match',
    },
  });

  await request({
    method: 'POST',
    path: '/external-data/requests',
    role: 'admin',
    idempotencyKey: uniqueKey('telco-high-risk-smoke'),
    body: {
      customerId: CUSTOMER_ID,
      providerCode: 'TELCO_GENERIC',
      queryType: 'PHONE_TRUST_CHECK',
      purpose: 'FRAUD_PREVENTION',
      decisionStage: 'MANUAL_REVIEW',
      input: { phoneNumber: '+59170000000' },
      scenario: 'fraud_signal_high',
    },
  });
}

if (process.argv[1]?.endsWith('external-providers-errors.smoke.ts') || process.argv[1]?.endsWith('external-providers-errors.smoke.js')) {
  void runExternalProvidersErrorSmoke().catch((error) => {
    console.error('[FAIL] External providers error smoke falló');
    console.error(error);
    process.exitCode = 1;
  });
}
