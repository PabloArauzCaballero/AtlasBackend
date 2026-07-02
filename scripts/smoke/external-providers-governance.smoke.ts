import { CUSTOMER_ID, request } from './http.js';

export async function runExternalProvidersGovernanceSmoke(): Promise<void> {
  await request({ method: 'GET', path: '/admin/external-providers/readiness', role: 'admin' });
  await request({ method: 'GET', path: '/admin/external-providers/quality-audit', role: 'admin' });
  await request({ method: 'GET', path: '/admin/external-providers/production-gate?strict=true', role: 'admin' });
  await request({ method: 'GET', path: '/admin/external-providers/sla?days=30', role: 'admin' });
  await request({ method: 'GET', path: `/external-data/users/${CUSTOMER_ID}/decision-package`, role: 'risk_analyst' });
}

if (
  process.argv[1]?.endsWith('external-providers-governance.smoke.ts') ||
  process.argv[1]?.endsWith('external-providers-governance.smoke.js')
) {
  void runExternalProvidersGovernanceSmoke().catch((error) => {
    console.error('[FAIL] External providers governance smoke falló');
    console.error(error);
    process.exitCode = 1;
  });
}
