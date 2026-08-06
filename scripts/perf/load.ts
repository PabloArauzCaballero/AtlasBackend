/**
 * `yarn perf:load --scenario=<smoke|baseline|load|stress|spike|soak>`
 *
 * Corrida de carga reproducible contra un backend YA arrancado. No arranca nada: la fase de higiene
 * y el arranque son pasos previos y explícitos (`yarn start:clean`), porque un generador de carga
 * que también levanta el servidor mide su propio arranque.
 *
 * Exige que el entorno esté declarado en el informe (commit, host, escenario, mezcla) para que dos
 * corridas se puedan comparar. Una medición sin sus condiciones no es un baseline, es una anécdota.
 */
import { execFileSync } from 'node:child_process';
import jwt, { SignOptions } from 'jsonwebtoken';
import { accessTokenSignOptions } from '../../src/common/utils/auth/jwt-claims.util.js';
import { env } from '../../src/config/env.js';
import { captureHostSnapshot } from './lib/host-resources.js';
import { writeEvidence } from './lib/evidence.js';
import { READ_FLOWS, type LoadFlow } from './lib/load-flows.js';
import { runLoadScenario, type ScenarioShape } from './lib/load-engine.js';
import { heapGrowthPercent, sampleBackendMetrics } from './lib/metrics-probe.js';
import { evaluateBudget, loadBudget, type BudgetVerdict } from './lib/budget.js';

const PROJECT_ROOT = process.cwd();

function flag(name: string, fallback: string): string {
  const found = process.argv.find((argument) => argument.startsWith(`--${name}=`));
  return found ? found.slice(name.length + 3) : fallback;
}

const SCENARIO = flag('scenario', 'smoke');
const ORIGIN = flag('base-url', `http://localhost:${env.APP_PORT}`).replace(/\/+$/, '');
const API_BASE = `${ORIGIN}/${env.API_PREFIX.replace(/^\/+|\/+$/g, '')}`;
const TENANT_ID = flag('tenant', process.env.TENANT_ID ?? '1');
const REQUEST_TIMEOUT_MS = Number(flag('timeout-ms', '15000'));

/** Un token por rol, firmado una sola vez: firmar por petición mediría HMAC, no el backend. */
const TOKEN_CACHE = new Map<string, string>();

function tokenFor(role: NonNullable<LoadFlow['role']>): string {
  const cached = TOKEN_CACHE.get(role);
  if (cached) return cached;
  const payload = {
    sub: `${role}-perf`,
    role,
    tenantId: TENANT_ID,
    ...(role === 'customer' ? { customerId: process.env.CUSTOMER_ID ?? '1' } : { internalUserId: '1' }),
  };
  const options: SignOptions = accessTokenSignOptions({
    algorithm: 'HS256',
    expiresIn: env.JWT_ACCESS_TOKEN_EXPIRES_IN as SignOptions['expiresIn'],
  });
  const token = jwt.sign(payload, env.JWT_ACCESS_TOKEN_SECRET, options);
  TOKEN_CACHE.set(role, token);
  return token;
}

async function execute(flow: LoadFlow): Promise<{ status: number | null; failure: 'http-status' | 'timeout' | 'network' | null }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  const headers: Record<string, string> = { accept: 'application/json', 'x-tenant-id': TENANT_ID };
  if (flow.role) headers.authorization = `Bearer ${tokenFor(flow.role)}`;

  try {
    const response = await fetch(`${API_BASE}${flow.path}`, { method: flow.method, headers, signal: controller.signal });
    // El cuerpo se consume siempre: dejarlo sin leer mantiene el socket ocupado y la siguiente
    // petición esperaría por una conexión que en realidad está libre.
    await response.arrayBuffer();
    return { status: response.status, failure: flow.expect.includes(response.status) ? null : 'http-status' };
  } catch (error) {
    const aborted = error instanceof Error && error.name === 'AbortError';
    return { status: null, failure: aborted ? 'timeout' : 'network' };
  } finally {
    clearTimeout(timer);
  }
}

function currentCommit(): string {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: PROJECT_ROOT, encoding: 'utf8' }).trim();
  } catch {
    return 'desconocido';
  }
}

function printVerdict(verdict: BudgetVerdict): void {
  console.log('');
  console.log('Presupuesto de rendimiento:');
  for (const check of verdict.checks) {
    const mark = check.ok ? 'ok  ' : check.enforced ? 'FALLA' : 'aviso';
    console.log(`  [${mark}] ${check.name}: ${check.detail}`);
  }
  if (!verdict.calibrated) {
    console.log('');
    console.log('ℹ️  Los umbrales de LATENCIA son provisionales (config/performance-budget.json → calibratedFrom: null).');
    console.log('    Se reportan pero no fallan la corrida. Calíbralos con un baseline en hardware representativo.');
  }
}

async function main(): Promise<void> {
  const budget = loadBudget(PROJECT_ROOT);
  const shape = budget.scenarios[SCENARIO] as ScenarioShape | undefined;
  if (!shape) {
    console.error(`Escenario desconocido: ${SCENARIO}. Disponibles: ${Object.keys(budget.scenarios).join(', ')}.`);
    process.exit(1);
  }

  const host = captureHostSnapshot(PROJECT_ROOT);
  console.log('── Prueba de carga ───────────────────────────────────────────────');
  console.log(
    `Escenario : ${SCENARIO} (${shape.arrivalRatePerSecond} req/s durante ${shape.durationSeconds}s, warm-up ${shape.warmupSeconds}s)`,
  );
  console.log(`Destino   : ${API_BASE}`);
  console.log(`Commit    : ${currentCommit()}`);
  console.log(`Mezcla    : ${READ_FLOWS.map((flow) => `${flow.name}×${flow.weight}`).join(', ')}`);
  console.log('');

  const probe = await fetch(`${API_BASE}/health`).catch(() => null);
  if (!probe) {
    console.error(`No hay backend respondiendo en ${API_BASE}. Arráncalo con \`yarn start:clean\` antes de medir.`);
    process.exit(1);
  }

  const metricsBefore = await sampleBackendMetrics(ORIGIN);
  if (!metricsBefore.reachable)
    console.log('⚠️  /metrics no responde: el informe no podrá atribuir la latencia a pool, heap o event loop.');

  const result = await runLoadScenario({
    shape,
    flows: READ_FLOWS,
    execute,
    onProgress: (second, snapshot) => {
      if (second % 10 === 0)
        console.log(`  t+${second}s  completadas=${snapshot.completed} errores=${snapshot.errors} en-vuelo=${snapshot.inFlight}`);
    },
  });

  const metricsAfter = await sampleBackendMetrics(ORIGIN);
  const heapGrowth = heapGrowthPercent(metricsBefore, metricsAfter);
  const verdict = evaluateBudget({ budget, scenario: SCENARIO, result, heapGrowthPercent: heapGrowth });

  console.log('');
  console.log(`Ventana medida    : ${result.measuredWindowSeconds}s (warm-up descartado)`);
  console.log(`Peticiones        : ${result.completed} completadas, ${result.dropped} descartadas por maxInFlight`);
  console.log(`Throughput        : ${result.throughputPerSecond} req/s`);
  console.log(`Tasa de error     : ${result.errorRatePercent}%  (5xx=${result.errors.serverErrors}, timeouts=${result.errors.timeouts})`);
  console.log(
    `Latencia global   : p50=${result.overall.p50Ms}ms p95=${result.overall.p95Ms}ms p99=${result.overall.p99Ms}ms max=${result.overall.maxMs}ms`,
  );
  console.log(`Retraso generador : p95=${Math.round(result.schedulerLagMs.p95)}ms max=${Math.round(result.schedulerLagMs.max)}ms`);
  if (result.schedulerLagMs.p95 > 100) {
    console.log('  ⚠️  El generador se retrasó: parte de la latencia medida es de este proceso, no del backend.');
  }
  console.log('');
  console.log('Por flujo:');
  for (const flow of result.perFlow) {
    console.log(
      `  ${flow.flow.padEnd(24)} n=${String(flow.count).padStart(6)} p50=${flow.p50Ms}ms p95=${flow.p95Ms}ms p99=${flow.p99Ms}ms errores=${flow.errors}`,
    );
  }
  if (metricsAfter.reachable) {
    console.log('');
    console.log(
      `Backend al cierre : pool using=${metricsAfter.dbPoolUsing ?? 'n/d'} waiting=${metricsAfter.dbPoolWaiting ?? 'n/d'} size=${metricsAfter.dbPoolSize ?? 'n/d'}`,
    );
    console.log(
      `                    event-loop lag p99=${metricsAfter.eventLoopLagP99Seconds ?? 'n/d'}s, crecimiento de heap=${heapGrowth ?? 'n/d'}%`,
    );
  }
  printVerdict(verdict);

  const reportPath = writeLoadReport({ shape, verdict, result, metricsBefore, metricsAfter, heapGrowth, host });
  console.log('');
  console.log(`Evidencia: ${reportPath}`);

  if (!verdict.passed) {
    console.error('');
    console.error('❌ La corrida no cumple el presupuesto de rendimiento aplicable.');
    process.exit(1);
  }
}

function writeLoadReport(input: Record<string, unknown>): string {
  return writeEvidence(PROJECT_ROOT, 'load', {
    phase: 'load',
    scenario: SCENARIO,
    target: API_BASE,
    commit: currentCommit(),
    tenantId: TENANT_ID,
    flows: READ_FLOWS,
    ...input,
  });
}

main().catch((error: unknown) => {
  console.error('[perf:load] falló:', error instanceof Error ? error.message : String(error));
  process.exit(1);
});
