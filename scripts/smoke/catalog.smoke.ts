import { request } from './http.js';

export async function runCatalogSmoke(): Promise<void> {
  await request({ method: 'GET', path: '/operations/catalogs', role: 'admin' });
  await request({ method: 'GET', path: '/operations/definitions?type=all&status=all', role: 'admin' });
  await request({ method: 'GET', path: '/operations/risk-policy/current', role: 'admin' });
  await request({ method: 'GET', path: '/operations/data-governance/policies', role: 'admin' });
}

if (process.argv[1]?.endsWith('catalog.smoke.ts') || process.argv[1]?.endsWith('catalog.smoke.js')) {
  void runCatalogSmoke();
}
