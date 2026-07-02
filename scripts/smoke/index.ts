import { runCatalogSmoke } from './catalog.smoke.js';
import { runCoreSmoke } from './core.smoke.js';
import { logSmokeConfig } from './http.js';
import { runAuthSmoke } from './auth.smoke.js';
import { runRiskTelemetrySmoke } from './risk-telemetry.smoke.js';
import { runRuntimeSmoke } from './runtime.smoke.js';
import { runEventsSmoke } from './events.smoke.js';
import { runNotificationsSmoke } from './notifications.smoke.js';
import { runExternalProvidersSmoke } from './external-providers.smoke.js';
import { runSessionsSmoke } from './sessions.smoke.js';

async function main(): Promise<void> {
  logSmokeConfig();
  await runAuthSmoke();
  await runCoreSmoke();
  await runCatalogSmoke();
  await runRuntimeSmoke();
  await runSessionsSmoke();
  await runRiskTelemetrySmoke();
  await runEventsSmoke();
  await runNotificationsSmoke();
  await runExternalProvidersSmoke();
  console.log('[OK] Smoke suite completa');
}

void main().catch((error) => {
  console.error('[FAIL] Smoke suite falló');
  console.error(error);
  process.exitCode = 1;
});
