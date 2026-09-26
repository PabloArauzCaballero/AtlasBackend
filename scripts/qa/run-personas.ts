/**
 * Motor QA: N personas independientes recorren los flujos documentados por HTTP real.
 *
 *   tsx scripts/qa/run-personas.ts --personas=20 --seed=atlas-2026 --base-url=http://127.0.0.1:3005/api/v1
 *
 * Qué lo diferencia de una ráfaga contra un endpoint:
 *
 * - Cada persona tiene su identidad, sus credenciales y SU sesión. Ninguna hereda el token de otra
 *   ni el del operador que lanza la corrida.
 * - Las personas se solapan de verdad: el informe publica el máximo de intervalos activos
 *   simultáneos, que es lo único que distingue concurrencia de un bucle secuencial rápido.
 * - Un paso que falla omite a sus dependientes con `SKIPPED_DEPENDENCY`, y un omitido NUNCA suma a
 *   `passed`. Es la forma más común de inflar una tasa de aprobación sin darse cuenta.
 * - Los percentiles salen de las muestras crudas y van con su `count`; por debajo del mínimo se
 *   declara muestra insuficiente en vez de publicar un p99 que no sostiene nada.
 *
 * Si el emulador expone su plano de control, la corrida da de alta un namespace propio y su journal
 * queda como evidencia de que el tráfico externo salió por la red.
 */
import { setTimeout as sleep } from 'node:timers/promises';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { buildPersonas, type Persona } from './persona-factory.js';
import { HttpActor, dataOf, type StepOutcome } from './http-actor.js';
import { JOURNEYS, judge, type Journey, type JourneyContext } from './journeys.js';
import { AdmissionGate } from './admission-gate.js';

type Args = {
  personas: number;
  seed: string;
  baseUrl: string;
  tenantId: string;
  mockBaseUrl: string | null;
  mockControlToken: string | null;
  outDir: string;
  timeoutMs: number;
  /** Tiempo de interacción entre pasos. Simula lectura de pantalla; NO es latencia HTTP. */
  thinkTimeMs: number;
  /**
   * Factor sobre los cupos declarados en cada paso. 1 = respeta el límite real del backend, que es
   * el valor correcto. Existe sólo para medir contra un entorno cuyo throttle se configuró distinto,
   * y subirlo para «conseguir una corrida verde» es exactamente lo que no hay que hacer.
   */
  rateFactor: number;
};

function parseArgs(argv: string[]): Args {
  const get = (name: string, fallback: string): string => {
    const found = argv.find((arg) => arg.startsWith(`--${name}=`));
    return found ? found.slice(name.length + 3) : fallback;
  };
  return {
    personas: Number(get('personas', '20')),
    seed: get('seed', 'atlas-qa'),
    baseUrl: get('base-url', 'http://127.0.0.1:3005/api/v1'),
    tenantId: get('tenant', '1'),
    mockBaseUrl: get('mock-url', 'http://127.0.0.1:4010') || null,
    mockControlToken: process.env.MOCK_PROVIDERS_CONTROL_TOKEN ?? null,
    outDir: get('out', 'evidencia/qa-personas'),
    timeoutMs: Number(get('timeout-ms', '15000')),
    thinkTimeMs: Number(get('think-ms', '120')),
    rateFactor: Number(get('rate-factor', '1')),
  };
}

/** Percentil por rango sobre muestras ordenadas. Nunca se promedian percentiles. */
function percentile(sorted: number[], fraction: number): number | null {
  if (sorted.length === 0) return null;
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(fraction * sorted.length) - 1))];
}

const MIN_SAMPLES = 30;

function summarize(samples: number[]) {
  const sorted = [...samples].sort((a, b) => a - b);
  return {
    count: sorted.length,
    min: sorted[0] ?? null,
    p50: percentile(sorted, 0.5),
    p95: percentile(sorted, 0.95),
    p99: percentile(sorted, 0.99),
    max: sorted[sorted.length - 1] ?? null,
    insufficientSamples: sorted.length < MIN_SAMPLES,
  };
}

/**
 * Máximo de personas activas a la vez, por barrido de intervalos.
 *
 * Es la única prueba de que hubo concurrencia: un bucle secuencial muy rápido produce las mismas
 * peticiones, la misma duración total y un máximo de 1. El paquete QA lo pide explícitamente
 * ("no confundir loops secuenciales con concurrencia").
 */
function maxOverlap(intervals: Array<{ start: number; end: number }>): number {
  const eventos = intervals.flatMap((interval) => [
    { t: interval.start, delta: 1 },
    { t: interval.end, delta: -1 },
  ]);
  eventos.sort((a, b) => a.t - b.t || a.delta - b.delta);
  let actual = 0;
  let maximo = 0;
  for (const evento of eventos) {
    actual += evento.delta;
    maximo = Math.max(maximo, actual);
  }
  return maximo;
}

async function resolveConsents(args: Args): Promise<Array<{ consentDocumentId: string; purposeCode: string }>> {
  const response = await fetch(`${args.baseUrl}/consent-documents/active`, { headers: { 'x-tenant-id': args.tenantId } });
  if (!response.ok) throw new Error(`No se pudo leer el catálogo de consentimientos: HTTP ${response.status}`);
  const body = (await response.json()) as { data?: Array<{ id: string; documentCode: string }> };
  const documentos = body.data ?? [];
  if (documentos.length === 0) throw new Error('El catálogo de consentimientos vino vacío: la corrida no puede dar de alta a nadie.');
  // IDs resueltos por consulta real, nunca quemados: un "1" universal es la forma más rápida de
  // que una corrida pase contra un catálogo que ya cambió.
  return documentos.map((documento) => ({ consentDocumentId: documento.id, purposeCode: documento.documentCode }));
}

/** Namespace propio en el emulador, si su plano de control está disponible. */
async function openMockRun(args: Args, runId: string): Promise<Record<string, string> | null> {
  if (!args.mockBaseUrl || !args.mockControlToken) return null;
  try {
    const response = await fetch(`${args.mockBaseUrl}/mock/control/runs`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${args.mockControlToken}`, 'x-mock-tenant-id': args.tenantId },
      body: JSON.stringify({ tenantId: args.tenantId, runId, seed: args.seed }),
    });
    if (response.status !== 201) return null;
    const body = (await response.json()) as { runToken: string };
    return { 'x-mock-tenant-id': args.tenantId, 'x-mock-run-id': runId, 'x-mock-run-token': body.runToken };
  } catch {
    return null;
  }
}

type JournalEvidence = {
  llamadasObservadas: number;
  proveedores: string[];
  personasDistintas: number;
};

/**
 * Peticiones que el emulador atendió en el namespace LEGACY, es decir, sin contexto de corrida.
 *
 * Hace falta medirlo porque hoy el backend NO propaga ese contexto: `qaContext` existe en
 * `ExternalProviderExecutionInput` y lo consume `callMockServer`, pero quien lo rellena tiene que
 * ser una corrida autorizada del propio backend, no un script externo. Y eso es deliberado — el
 * emulador rechaza a propósito que una cabecera de cliente elija namespace (`INVALID_RUN_TOKEN`).
 *
 * Consecuencia práctica: el tráfico de esta corrida SÍ sale por la red y SÍ deja rastro, pero en el
 * namespace legacy. Contarlo por diferencia es lo que permite afirmar "el tráfico salió" sin
 * atribuirle al emulador una capacidad que todavía no está cableada.
 */
async function legacyRequestCount(args: Args): Promise<number | null> {
  if (!args.mockBaseUrl || !args.mockControlToken) return null;
  try {
    const response = await fetch(`${args.mockBaseUrl}/mock/control/runs`, {
      headers: { authorization: `Bearer ${args.mockControlToken}`, 'x-mock-tenant-id': args.tenantId },
    });
    if (!response.ok) return null;
    const body = (await response.json()) as { runs: Array<{ key: string; requestCount: number }> };
    return body.runs.find((run) => run.key === '__legacy__')?.requestCount ?? 0;
  } catch {
    return null;
  }
}

async function readJournal(args: Args, runId: string): Promise<JournalEvidence | null> {
  if (!args.mockBaseUrl || !args.mockControlToken) return null;
  try {
    const response = await fetch(`${args.mockBaseUrl}/mock/control/runs/${runId}/journal?limit=1000`, {
      headers: { authorization: `Bearer ${args.mockControlToken}`, 'x-mock-tenant-id': args.tenantId },
    });
    if (!response.ok) return null;
    const body = (await response.json()) as {
      entries: Array<{ provider?: string; personaKey?: string | null; type?: string }>;
      totalAppended: number;
    };
    const atendidas = body.entries.filter((entry) => entry.type === 'responded');
    return {
      llamadasObservadas: atendidas.length,
      proveedores: [...new Set(atendidas.map((entry) => entry.provider ?? '-'))].sort(),
      personasDistintas: new Set(atendidas.map((entry) => entry.personaKey ?? '-')).size,
    };
  } catch {
    return null;
  }
}

type PersonaResult = {
  persona: Pick<Persona, 'personaKey' | 'archetype' | 'caseCategory' | 'documentNumber' | 'email'>;
  journeys: Array<{ code: string; outcomes: StepOutcome[]; terminal: string }>;
  startedAt: number;
  finishedAt: number;
  resources: Record<string, string>;
};

async function runPersona(
  persona: Persona,
  args: Args,
  shared: {
    consents: Array<{ consentDocumentId: string; purposeCode: string }>;
    runHeaders: Record<string, string> | null;
    runNonce: string;
    signal: AbortSignal;
    gates: Map<string, AdmissionGate>;
    admissionLags: number[];
  },
): Promise<PersonaResult> {
  const actor = new HttpActor({
    baseUrl: args.baseUrl,
    tenantId: args.tenantId,
    personaKey: persona.personaKey,
    runHeaders: shared.runHeaders ?? undefined,
    timeoutMs: args.timeoutMs,
  });
  const ctx: JourneyContext = { actor, persona, consents: shared.consents, signal: shared.signal, runNonce: shared.runNonce };
  const startedAt = performance.now();
  const journeys: PersonaResult['journeys'] = [];

  for (const journey of JOURNEYS) {
    const outcomes = await runJourney(journey, ctx, args, shared);
    journeys.push({
      code: journey.code,
      outcomes,
      terminal: outcomes.some((outcome) => outcome.outcome === 'FAILED')
        ? 'FAILED'
        : outcomes.some((outcome) => outcome.outcome === 'INDETERMINATE')
          ? 'INDETERMINATE'
          : outcomes.some((outcome) => outcome.outcome === 'SKIPPED_DEPENDENCY')
            ? 'PARTIAL'
            : 'COMPLETED',
    });
    // Un recorrido que no llegó a su terminal no puede encadenar al siguiente: los pasos de
    // `post_login_first_screen` necesitan el `customerId` que produce el alta.
    if (journeys[journeys.length - 1].terminal === 'FAILED' && !actor.resources.customerId) break;
  }

  return {
    persona: {
      personaKey: persona.personaKey,
      archetype: persona.archetype,
      caseCategory: persona.caseCategory,
      documentNumber: persona.documentNumber,
      email: persona.email,
    },
    journeys,
    startedAt,
    finishedAt: performance.now(),
    resources: actor.resources,
  };
}

async function runJourney(
  journey: Journey,
  ctx: JourneyContext,
  args: Args,
  shared: { gates: Map<string, AdmissionGate>; admissionLags: number[] },
): Promise<StepOutcome[]> {
  const actor = ctx.actor;
  const antes = actor.outcomes.length;

  for (let index = 0; index < journey.steps.length; index += 1) {
    const step = journey.steps[index];
    if (ctx.signal.aborted) {
      actor.skipRemaining(
        journey.steps
          .slice(index)
          .map((pendiente) => ({ stepKey: pendiente.stepKey, method: pendiente.method, path: pendiente.path(ctx) })),
        'corrida cancelada',
      );
      break;
    }

    // Compuerta de admisión antes del paso limitado: la espera se mide y se reporta aparte de la
    // latencia HTTP, porque son dos cosas distintas y sumarlas oculta cuál es el cuello de botella.
    if (step.rateLimited) {
      const gate = shared.gates.get(step.rateLimited.bucket);
      if (gate) shared.admissionLags.push((await gate.admit(ctx.signal)).admissionLagMs);
    }

    const lanzar = () =>
      actor.request({
        stepKey: step.stepKey,
        method: step.method,
        path: step.path(ctx),
        body: step.body ? step.body(ctx) : undefined,
        auth: step.auth,
        idempotencyKey: step.idempotencyKey ? step.idempotencyKey(ctx) : undefined,
        signal: ctx.signal,
      });

    let attempt = await lanzar();

    /*
     * 429 en un paso limitado: se espera y se reintenta, que es lo que hace un cliente correcto.
     *
     * La compuerta local no alcanza sola, y por un motivo concreto: el backend cuenta por IP y por
     * ventana de sesenta segundos, no por proceso. Dos corridas seguidas comparten ese cupo, así que
     * la segunda arranca con la ventana medio gastada y su compuerta —que nace vacía— no lo sabe.
     *
     * El reintento NO es un intento nuevo del recorrido: es la MISMA intención, con la misma clave
     * de idempotencia. La espera se contabiliza como admisión, no como latencia del backend; si se
     * sumara a la latencia, el informe diría que el alta tarda un minuto.
     */
    for (let reintento = 0; reintento < 3 && step.rateLimited && attempt.status === 429; reintento += 1) {
      const esperaMs = 61_000;
      const empezoEspera = performance.now();
      await sleep(esperaMs);
      shared.admissionLags.push(performance.now() - empezoEspera);
      attempt = await lanzar();
    }

    const outcome = judge({
      step,
      status: attempt.status,
      body: attempt.body,
      latencyMs: attempt.latencyMs,
      ctx,
      transportError: attempt.error,
    });
    actor.record(outcome);

    if (outcome.outcome === 'PASSED' && step.extract) step.extract(dataOf(attempt.body), ctx);

    if (outcome.outcome !== 'PASSED' && !step.optional) {
      // Se omiten los dependientes con su motivo, en vez de seguir lanzando peticiones que van a
      // fallar por falta de un recurso y ensuciar el diagnóstico con ruido derivado.
      actor.skipRemaining(
        journey.steps
          .slice(index + 1)
          .map((pendiente) => ({ stepKey: pendiente.stepKey, method: pendiente.method, path: pendiente.path(ctx) })),
        `depende de ${step.stepKey}`,
      );
      break;
    }

    if (args.thinkTimeMs > 0) await sleep(args.thinkTimeMs);
  }

  return actor.outcomes.slice(antes);
}

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2));
  const runId = `qa-run-${Date.now().toString(36)}`;
  const runNonce = randomUUID().slice(0, 8);
  const refDate = new Date();

  console.log(`Motor QA Atlas — ${args.personas} personas, semilla "${args.seed}", destino ${args.baseUrl}`);

  const consents = await resolveConsents(args);
  console.log(`  catálogo de consentimientos: ${consents.length} documento(s) vigentes`);

  const runHeaders = await openMockRun(args, runId);
  console.log(`  emulador: ${runHeaders ? `namespace ${runId} dado de alta` : 'sin plano de control (el journal no estará disponible)'}`);

  // `runNamespace` = `runId`: la misma semilla vuelve a producir las mismas personas, con
  // identificadores operacionales nuevos que no chocan con los clientes de la corrida anterior.
  const personas = buildPersonas({ masterSeed: args.seed, count: args.personas, refDate, runNamespace: runId });
  // Marca del legacy ANTES de la corrida: lo que llegue de más es de esta corrida.
  const legacyAntes = await legacyRequestCount(args);
  const controller = new AbortController();
  // Un cubo por endpoint limitado, con el cupo que el propio controlador declara.
  const gates = new Map<string, AdmissionGate>();
  for (const journey of JOURNEYS) {
    for (const step of journey.steps) {
      if (step.rateLimited && !gates.has(step.rateLimited.bucket)) {
        gates.set(
          step.rateLimited.bucket,
          new AdmissionGate(Math.max(1, Math.round(step.rateLimited.perMinute * args.rateFactor)), 60_000),
        );
      }
    }
  }
  const admissionLags: number[] = [];
  const comenzo = performance.now();
  console.log(`  compuertas de admision: ${[...gates.keys()].join(', ')} (limites reales del backend, factor ${args.rateFactor})`);

  // Todas a la vez: es el modelo "closed / concurrent personas" del paquete. El solapamiento se
  // mide después y se publica; no se afirma.
  const resultados = await Promise.all(
    personas.map((persona) =>
      runPersona(persona, args, { consents, runHeaders, runNonce, signal: controller.signal, gates, admissionLags }),
    ),
  );
  const duracionMs = performance.now() - comenzo;

  const todos = resultados.flatMap((resultado) => resultado.journeys.flatMap((journey) => journey.outcomes));
  const porEstado = (estado: StepOutcome['outcome']) => todos.filter((outcome) => outcome.outcome === estado).length;
  const latencias = todos.filter((outcome) => outcome.httpStatus !== null).map((outcome) => outcome.latencyMs);

  const porRecorrido = JOURNEYS.map((journey) => {
    const deEste = resultados.flatMap((resultado) => resultado.journeys.filter((candidato) => candidato.code === journey.code));
    const pasos = deEste.flatMap((entrada) => entrada.outcomes);
    return {
      code: journey.code,
      name: journey.name,
      personas: deEste.length,
      completados: deEste.filter((entrada) => entrada.terminal === 'COMPLETED').length,
      parciales: deEste.filter((entrada) => entrada.terminal === 'PARTIAL').length,
      fallados: deEste.filter((entrada) => entrada.terminal === 'FAILED').length,
      indeterminados: deEste.filter((entrada) => entrada.terminal === 'INDETERMINATE').length,
      pasos: {
        passed: pasos.filter((paso) => paso.outcome === 'PASSED').length,
        failed: pasos.filter((paso) => paso.outcome === 'FAILED').length,
        skipped: pasos.filter((paso) => paso.outcome === 'SKIPPED_DEPENDENCY').length,
        indeterminate: pasos.filter((paso) => paso.outcome === 'INDETERMINATE').length,
      },
      latencia: summarize(pasos.filter((paso) => paso.httpStatus !== null).map((paso) => paso.latencyMs)),
      fallosDistintos: [
        ...new Set(pasos.filter((paso) => paso.outcome === 'FAILED').map((paso) => `${paso.stepKey}: ${paso.reason ?? '-'}`)),
      ],
    };
  });

  const solapamiento = maxOverlap(resultados.map((resultado) => ({ start: resultado.startedAt, end: resultado.finishedAt })));
  const journal = await readJournal(args, runId);
  const legacyDespues = await legacyRequestCount(args);
  const llamadasSinContexto = legacyAntes === null || legacyDespues === null ? null : legacyDespues - legacyAntes;

  /*
   * El oráculo que no se puede falsificar desde el backend: lo que el EMULADOR vio.
   *
   * Se cuentan las consultas externas que el recorrido dio por exitosas y se comparan con las
   * llamadas que el emulador registró. Tres lecturas, todas útiles:
   *
   * - journal vacío con consultas exitosas ⇒ el tráfico NO salió por la red (un `fetch`
   *   interceptado, o una caché que respondió). Es el fallo que este bloque existe para atrapar.
   * - journal con MÁS llamadas que consultas ⇒ algo llamó de más: la vista previa de costo, que
   *   por contrato no debe ejecutar al proveedor, o un reintento no contabilizado.
   * - journal vacío sin consultas exitosas ⇒ la política bloqueó antes de llamar, y esa AUSENCIA
   *   es la expectativa correcta, no un fallo.
   */
  const consultasExternas = todos.filter((outcome) => outcome.stepKey === 'credit.external_request' && outcome.outcome === 'PASSED').length;

  /*
   * El modo EFECTIVO del proveedor decide si ausencia de journal es defecto o es lo esperado.
   *
   * Con `mock_local` el backend construye la respuesta EN PROCESO y no llama a nadie: el journal
   * vacío es correcto y marcarlo como fallo sería el error contrario, tan malo como el que este
   * bloque persigue. Sólo en `mock_server` la ausencia de evidencia significa que el tráfico no
   * salió. El modo se lee del propio resultado del recorrido, no se supone.
   */
  const modosObservados = [
    ...new Set(
      resultados.map((resultado) => resultado.resources.externalModeUsed).filter((modo): modo is string => typeof modo === 'string'),
    ),
  ];
  const enModoEmulador = modosObservados.includes('mock_server');

  const evidenciaExterna =
    journal === null
      ? { veredicto: 'NO_DISPONIBLE', detalle: 'El emulador no expuso su plano de control: no hay evidencia externa que cruzar.' }
      : consultasExternas === 0
        ? {
            veredicto: journal.llamadasObservadas === 0 ? 'SIN_TRAFICO_ESPERADO' : 'TRAFICO_INESPERADO',
            detalle:
              journal.llamadasObservadas === 0
                ? 'Ninguna consulta externa tuvo éxito y el emulador no registró llamadas: coherente.'
                : `El emulador registró ${journal.llamadasObservadas} llamada(s) que ninguna consulta exitosa explica.`,
          }
        : journal.llamadasObservadas === 0
          ? enModoEmulador
            ? llamadasSinContexto !== null && llamadasSinContexto > 0
              ? {
                  // El tráfico salió y dejó rastro, pero sin contexto de corrida. No es lo mismo
                  // que no haber salido, y confundirlos haría perder el diagnóstico real.
                  veredicto: 'SIN_CONTEXTO_DE_CORRIDA',
                  detalle:
                    `${consultasExternas} consulta(s) en modo mock_server; el emulador atendió ${llamadasSinContexto} ` +
                    'en el namespace legacy. El tráfico SÍ salió por la red. Falta que el backend propague ' +
                    '`qaContext` desde una corrida autorizada: el emulador rechaza —a propósito— que una cabecera ' +
                    'del cliente elija namespace.',
                }
              : {
                  veredicto: 'EVIDENCIA_AUSENTE',
                  detalle: `${consultasExternas} consulta(s) en modo mock_server y el emulador no vio ninguna, ni siquiera en legacy: el tráfico NO salió por la red.`,
                }
            : {
                veredicto: 'PROVEEDOR_EN_PROCESO',
                detalle:
                  `${consultasExternas} consulta(s) resueltas en modo ${modosObservados.join('/') || 'desconocido'}: ` +
                  'el backend responde en proceso y no llama al emulador. Journal vacío es lo correcto; ' +
                  'para medir integración real hace falta SEGIP_MODE=mock_server.',
              }
          : {
              veredicto: journal.llamadasObservadas === consultasExternas ? 'COHERENTE' : 'LLAMADAS_DE_MAS',
              detalle: `${consultasExternas} consulta(s) exitosa(s) y ${journal.llamadasObservadas} llamada(s) observada(s) por el emulador.`,
            };

  // Fuga entre personas: dos actores con el mismo `customerId` significan que alguien recibió la
  // sesión de otro. Es el gate que ninguna tasa de aprobación puede compensar.
  const customerIds = resultados.map((resultado) => resultado.resources.customerId).filter(Boolean);
  const idsUnicos = new Set(customerIds).size;

  const informe = {
    runId,
    seed: args.seed,
    runNamespace: runId,
    refDate: refDate.toISOString(),
    baseUrl: args.baseUrl,
    personas: args.personas,
    durationMs: Math.round(duracionMs),
    concurrencia: { maxPersonasSolapadas: solapamiento, esConcurrente: solapamiento > 1 },
    aislamiento: {
      customersCreados: customerIds.length,
      customerIdsDistintos: idsUnicos,
      sinFugaEntrePersonas: customerIds.length === idsUnicos,
    },
    pasos: {
      total: todos.length,
      passed: porEstado('PASSED'),
      failed: porEstado('FAILED'),
      skippedDependency: porEstado('SKIPPED_DEPENDENCY'),
      indeterminate: porEstado('INDETERMINATE'),
      // Denominador explícito: los omitidos NO están en el numerador ni en el denominador.
      assertionPassRate: todos.length === 0 ? null : porEstado('PASSED') / (porEstado('PASSED') + porEstado('FAILED') || 1),
    },
    latenciaHttp: summarize(latencias),
    // `admissionLag` separado de la latencia: delata cuando el cuello de botella es la cola del
    // propio generador —aqui, el cupo del alta— y no el backend.
    admissionLag: summarize(admissionLags),
    recorridos: porRecorrido,
    categorias: ['VALID', 'BOUNDARY', 'ERROR'].map((categoria) => ({
      categoria,
      personas: resultados.filter((resultado) => resultado.persona.caseCategory === categoria).length,
    })),
    evidenciaEmulador: {
      journal,
      consultasExternasExitosas: consultasExternas,
      modosObservados,
      llamadasEnNamespaceLegacy: llamadasSinContexto,
      ...evidenciaExterna,
    },
    detalle: resultados,
  };

  mkdirSync(args.outDir, { recursive: true });
  const destino = join(args.outDir, `${runId}.json`);
  writeFileSync(destino, JSON.stringify(informe, null, 2), 'utf8');

  console.log(`\n  duración: ${Math.round(duracionMs)} ms`);
  console.log(`  concurrencia: máximo ${solapamiento} personas activas a la vez ${solapamiento > 1 ? '(concurrente)' : '(SECUENCIAL)'}`);
  console.log(`  aislamiento: ${idsUnicos}/${customerIds.length} customerId distintos`);
  console.log(
    `  pasos: ${porEstado('PASSED')} passed · ${porEstado('FAILED')} failed · ${porEstado('SKIPPED_DEPENDENCY')} skipped · ${porEstado('INDETERMINATE')} indeterminate`,
  );
  for (const recorrido of porRecorrido) {
    console.log(
      `  ${recorrido.code}: ${recorrido.completados} completos / ${recorrido.personas} personas · ` +
        `pasos ${recorrido.pasos.passed}✓ ${recorrido.pasos.failed}✗ ${recorrido.pasos.skipped}⤼`,
    );
    for (const fallo of recorrido.fallosDistintos.slice(0, 5)) console.log(`      ✗ ${fallo}`);
  }
  console.log(
    `  latencia HTTP p50/p95 = ${informe.latenciaHttp.p50}/${informe.latenciaHttp.p95} ms sobre ${informe.latenciaHttp.count} muestras${informe.latenciaHttp.insufficientSamples ? ' (MUESTRA INSUFICIENTE)' : ''}`,
  );
  console.log(`  espera en la compuerta de admision p95 = ${informe.admissionLag.p95} ms sobre ${informe.admissionLag.count} admisiones`);
  console.log(`  evidencia externa (journal del emulador): ${evidenciaExterna.veredicto} — ${evidenciaExterna.detalle}`);
  console.log(`  evidencia: ${destino}`);

  // Salida no exitosa si hay fallos reales o fuga: un gate que no puede fallar no es un gate.
  // Un gate que no puede fallar no es un gate: fallo real, fuga entre personas, o evidencia
  // externa que contradice lo que el backend afirmó.
  const evidenciaRota = evidenciaExterna.veredicto === 'EVIDENCIA_AUSENTE' || evidenciaExterna.veredicto === 'LLAMADAS_DE_MAS';
  return porEstado('FAILED') > 0 || customerIds.length !== idsUnicos || evidenciaRota ? 1 : 0;
}

main().then(
  (code) => process.exit(code),
  (error) => {
    console.error(`Motor QA: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  },
);
