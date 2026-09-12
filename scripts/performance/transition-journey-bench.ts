/**
 * @file Medición local del recorrido crítico (AT-054): admisión de crédito + entrega por el relay v2.
 * @business Antes de comparar monolito y piloto hace falta una línea base MEDIDA con el mismo dataset y el
 *   mismo código; este guion la produce contra la base de pruebas y la deja como evidencia con fecha, sin
 *   convertir una estimación en benchmark. Las cifras son de la máquina donde se corrió, no de producción.
 * @system `ATLAS_TEST_DATABASE_ISOLATED=true yarn tsx scripts/performance/transition-journey-bench.ts [--n 100]
 *   [--concurrency 10]`. Usa la misma fachada de admisión que la API (sin HTTP) y el relay v2 con un consumidor
 *   que cuenta entregas; escribe `docs/testing/evidence/transition-performance-<fecha>.json`.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { join } from 'node:path';
import { OutboxEventModel } from '../../src/database/models/index.js';
import { ConsumerRegistry } from '../../src/platform/events/consumer-registry.js';
import type { EventConsumer } from '../../src/platform/events/event-consumer.port.js';
import { LocalConsumerDispatchPublisher, OutboxRelayService } from '../../src/platform/events/outbox-relay.service.js';
import { buildAdmissionHarness, customerUser, eligibleFacts } from '../../test/integration/credit/support/admission-harness.js';
import { openIntegrationDatabase } from '../../test/integration/support/database.js';

function arg(name: string, fallback: number): number {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? Number(process.argv[index + 1]) : fallback;
}

function percentiles(samples: number[]): { p50: number; p95: number; p99: number; max: number; mean: number } {
  const sorted = [...samples].sort((a, b) => a - b);
  const at = (q: number) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
  return {
    p50: round(at(0.5)),
    p95: round(at(0.95)),
    p99: round(at(0.99)),
    max: round(sorted[sorted.length - 1]),
    mean: round(sorted.reduce((sum, value) => sum + value, 0) / sorted.length),
  };
}
const round = (value: number) => Math.round(value * 100) / 100;

async function main(): Promise<void> {
  const n = arg('n', 100);
  const concurrency = arg('concurrency', 10);
  const database = await openIntegrationDatabase();
  if (!database) throw new Error('sin base de pruebas');
  const harness = await buildAdmissionHarness(database.sequelize);
  // Hechos elegibles fijos: se mide el camino de escritura, no la variedad de datos del cliente.
  harness.eligibilityRepository.loadFacts = async () => eligibleFacts();
  const delivered: string[] = [];
  const consumer: EventConsumer = {
    consumerId: 'bench.consumer',
    subscriptions: { 'credit.application.submitted': [1] },
    async handle(event) {
      delivered.push(event.eventId);
    },
  };
  const relay = new OutboxRelayService(
    database.sequelize,
    [],
    new LocalConsumerDispatchPublisher(database.sequelize, new ConsumerRegistry([consumer])),
  );
  const body = { productId: harness.productId, requestedAmount: 1500, requestedTermMonths: 6 };

  try {
    const customers: string[] = [];
    for (let index = 0; index < n; index += 1) customers.push(await harness.createCustomer('active'));
    const submit = async (customerId: string): Promise<number> => {
      const started = performance.now();
      await harness.admission.persistApplication({
        tenantId: harness.tenantId,
        customerId,
        body,
        currentUser: customerUser(customerId),
        idempotencyKey: `bench-${customerId}`,
      });
      return performance.now() - started;
    };

    // Régimen 1: secuencial (latencia pura del recorrido de escritura).
    const sequential: number[] = [];
    const half = Math.floor(n / 2);
    const startedSequential = performance.now();
    for (const customerId of customers.slice(0, half)) sequential.push(await submit(customerId));
    const sequentialMs = performance.now() - startedSequential;

    // Régimen 2: concurrente por tandas (contención de la base: bloqueo de fila, índices únicos, outbox).
    const concurrent: number[] = [];
    const startedConcurrent = performance.now();
    const rest = customers.slice(half);
    for (let index = 0; index < rest.length; index += concurrency) {
      const batch = rest.slice(index, index + concurrency);
      concurrent.push(...(await Promise.all(batch.map(submit))));
    }
    const concurrentMs = performance.now() - startedConcurrent;

    // Relay v2: entrega de todos los eventos producidos (lotes de 100).
    const startedRelay = performance.now();
    let published = 0;
    for (;;) {
      const result = await relay.run({ tenantId: harness.tenantId, limit: 100, workerId: 'bench' });
      published += result.published;
      if (result.claimed === 0) break;
    }
    const relayMs = performance.now() - startedRelay;

    const evidence = {
      $comment: 'AT-054: medición LOCAL (máquina de desarrollo, PostgreSQL en docker). No es una línea base de producción ni un objetivo.',
      measuredAt: new Date().toISOString(),
      node: process.version,
      platform: `${process.platform}/${process.arch}`,
      dataset: { customers: n, product: 'IT (harness)', tenant: 'aislado por corrida' },
      submitSequential: {
        samples: sequential.length,
        latencyMs: percentiles(sequential),
        throughputPerSecond: round((sequential.length / sequentialMs) * 1000),
      },
      submitConcurrent: {
        samples: concurrent.length,
        concurrency,
        latencyMs: percentiles(concurrent),
        throughputPerSecond: round((concurrent.length / concurrentMs) * 1000),
      },
      relayV2: {
        published,
        delivered: delivered.length,
        throughputPerSecond: round((published / relayMs) * 1000),
        totalMs: round(relayMs),
      },
    };
    const dir = join(process.cwd(), 'docs', 'testing', 'evidence');
    mkdirSync(dir, { recursive: true });
    const file = join(dir, `transition-performance-${evidence.measuredAt.slice(0, 10)}.json`);
    writeFileSync(file, `${JSON.stringify(evidence, null, 2)}\n`);
    console.log(JSON.stringify(evidence, null, 2));
    console.log(`evidencia: ${file}`);
    if (delivered.length !== published || published !== n)
      throw new Error(`BENCH_INCONSISTENT: n=${n} published=${published} delivered=${delivered.length}`);
  } finally {
    await OutboxEventModel.destroy({ where: { tenantId: harness.tenantId } });
    await harness.cleanup();
    await database.close();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack : String(error));
  process.exit(1);
});
