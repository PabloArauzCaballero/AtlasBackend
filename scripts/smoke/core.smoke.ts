import { CUSTOMER_ID, request, uniqueKey } from './http.js';

export async function runCoreSmoke(): Promise<void> {
  await request({ method: 'GET', path: '/health' });
  await request({ method: 'GET', path: '/consent-documents/active?language=es' });
  await request({ method: 'GET', path: `/customers/${CUSTOMER_ID}/me`, role: 'customer' });
  await request({ method: 'GET', path: '/operations/work-queue?queue=all&page=1&limit=20', role: 'admin' });
  await request({ method: 'GET', path: `/operations/customers/${CUSTOMER_ID}/investigation-summary`, role: 'admin' });
  await request({ method: 'GET', path: `/operations/audit/customer/${CUSTOMER_ID}?page=1&limit=20`, role: 'admin' });
  await request({ method: 'GET', path: '/operations/data-quality/issues?page=1&limit=20', role: 'admin' });

  await request({
    method: 'POST',
    path: `/customers/${CUSTOMER_ID}/privacy/consent-decisions`,
    role: 'customer',
    idempotencyKey: uniqueKey('smoke-consent-decision'),
    extraHeaders: { 'x-client-channel': 'mobile_app' },
    body: {
      decisions: [
        {
          consentDocumentId: '1',
          purposeCode: 'risk_fraud_assessment',
          decision: 'granted',
          decidedAt: new Date().toISOString(),
          sessionId: '1',
        },
      ],
    },
  });

  await request({
    method: 'POST',
    path: `/customers/${CUSTOMER_ID}/privacy/data-subject-requests`,
    role: 'customer',
    idempotencyKey: uniqueKey('smoke-dsr'),
    body: { requestType: 'access', description: 'Smoke test local de solicitud de acceso a datos.' },
  });
}

if (process.argv[1]?.endsWith('core.smoke.ts') || process.argv[1]?.endsWith('core.smoke.js')) {
  void runCoreSmoke();
}
