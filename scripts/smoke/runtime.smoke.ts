import { request } from './http.js';

export async function runRuntimeSmoke(): Promise<void> {
  const key = Date.now();
  await request({
    method: 'POST',
    path: '/operations/jobs/process-outbox',
    role: 'admin',
    idempotencyKey: `smoke-outbox-${key}`,
    body: { limit: 10, dryRun: true },
  });
  await request({
    method: 'POST',
    path: '/operations/jobs/expire-stale-sessions',
    role: 'admin',
    idempotencyKey: `smoke-expire-sessions-${key}`,
    body: { maxIdleMinutes: 120, dryRun: true },
  });
  await request({
    method: 'POST',
    path: '/operations/jobs/apply-retention-policies',
    role: 'admin',
    idempotencyKey: `smoke-retention-${key}`,
    body: { dryRun: true },
  });
  await request({
    method: 'POST',
    path: '/operations/jobs/recalculate-data-quality',
    role: 'admin',
    idempotencyKey: `smoke-dq-${key}`,
    body: { dryRun: true },
  });
}

if (process.argv[1]?.endsWith('runtime.smoke.ts') || process.argv[1]?.endsWith('runtime.smoke.js')) {
  void runRuntimeSmoke();
}
