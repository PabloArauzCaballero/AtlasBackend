/**
 * @file Comprueba con una llamada saliente REAL que `undici` está instrumentado y saneado.
 * @business Esta pieza impide que una credencial de descarga salga del proceso dentro de una traza.
 * @system arranca el SDK de verdad, hace un `fetch` contra un servidor local y verifica el span.
 *
 * Por qué existe además de las pruebas unitarias: `telemetry.instrumentations.spec.ts` comprueba
 * la CONFIGURACIÓN de `UndiciInstrumentation` —que el hook de exclusión es el correcto— pero no
 * que el parche llegue a instalarse ni que el span resultante esté limpio. Eso sólo se ve
 * haciendo una petición de verdad, y el fallo que previene es silencioso: si `fetch` deja de
 * estar instrumentado, no hay error, simplemente desaparecen las llamadas salientes de las
 * trazas y nadie lo nota hasta que hace falta diagnosticar una integración.
 *
 * Lo que verifica:
 *   1. Nace un span CLIENT de `@opentelemetry/instrumentation-undici`.
 *   2. Cuelga del span de negocio activo, no de la raíz: el contexto se propaga por `fetch`.
 *   3. La CADENA DE CONSULTA no aparece. Se pide a propósito una URL con la forma de una URL
 *      firmada de MinIO (`X-Amz-Signature`, `X-Amz-Credential`), que es por donde se filtraría
 *      una credencial de descarga del carnet o la selfie de un cliente.
 *
 * Uso:  yarn jaeger:up && npx tsx scripts/verify-outbound-http.ts
 *
 * Lo que NO cubre: TLS, DNS ni el comportamiento de un proveedor de terceros real. El servidor
 * es local y a propósito, para que la comprobación sea determinista y no dependa de la red.
 */
import { createServer } from 'node:http';
import { setTimeout as esperar } from 'node:timers/promises';
import { startTracing, stopTracing } from '../src/observability/tracing.js';

const PUERTO = Number(process.env.VERIFY_OUTBOUND_PORT ?? 54321);
const FIRMA = 'X-Amz-Signature=firma-que-no-debe-salir&X-Amz-Credential=credencial-que-no-debe-salir';
const RUTA = '/atlas/carnet.jpg';
const SERVICIO = 'verificacion-http-saliente';

/** Endpoint de consulta de Jaeger, derivado del de exportación si no se declara. */
function consultaJaeger(): string {
  const declarado = process.env.JAEGER_QUERY_URL;
  if (declarado !== undefined && declarado.trim() !== '') return declarado.replace(/\/+$/, '');
  return 'http://localhost:16686';
}

type SpanJaeger = {
  operationName: string;
  references: { refType: string; spanID: string }[];
  spanID: string;
  tags: { key: string; value: unknown }[];
};

async function main(): Promise<void> {
  process.env.OTEL_ENABLED = 'true';
  process.env.OTEL_TRACES_SAMPLER_ARG = '1';
  process.env.OTEL_SERVICE_NAME = SERVICIO;
  process.env.OTEL_EXPORTER_OTLP_ENDPOINT ??= 'http://127.0.0.1:4318';
  startTracing(SERVICIO);

  // Se importa DESPUÉS de arrancar el SDK, como en los entrypoints reales.
  const { context, trace } = await import('@opentelemetry/api');

  const servidor = createServer((_peticion, respuesta) => {
    respuesta.writeHead(200, { 'content-type': 'application/json' });
    respuesta.end('{"ok":true}');
  });
  await new Promise<void>((resolver) => servidor.listen(PUERTO, '127.0.0.1', resolver));

  const padre = trace.getTracer('verificacion').startSpan('negocio.llamada.externa');
  await context.with(trace.setSpan(context.active(), padre), async () => {
    const respuesta = await fetch(`http://127.0.0.1:${PUERTO}${RUTA}?${FIRMA}`);
    await respuesta.text();
  });
  padre.end();

  await new Promise<void>((resolver) => servidor.close(() => resolver()));
  await stopTracing();

  // El exportador es por lotes y Jaeger indexa con retardo; se reintenta en vez de dormir una vez.
  const spans = await buscarSpans();
  verificar(spans);
}

async function buscarSpans(): Promise<SpanJaeger[]> {
  for (let intento = 1; intento <= 10; intento += 1) {
    await esperar(1000);
    const respuesta = await fetch(`${consultaJaeger()}/api/traces?service=${SERVICIO}&limit=1&lookback=5m`);
    if (!respuesta.ok) continue;
    const cuerpo = (await respuesta.json()) as { data: { spans: SpanJaeger[] }[] };
    const traza = cuerpo.data[0];
    if (traza !== undefined && traza.spans.length >= 2) return traza.spans;
  }
  throw new Error(`No llegó ninguna traza de "${SERVICIO}" a ${consultaJaeger()}. ¿Está Jaeger levantado (yarn jaeger:up)?`);
}

function verificar(spans: SpanJaeger[]): void {
  const fallos: string[] = [];
  const porId = new Map(spans.map((span) => [span.spanID, span]));
  const etiqueta = (span: SpanJaeger, clave: string): string | undefined =>
    span.tags.find((t) => t.key === clave)?.value as string | undefined;

  const cliente = spans.find((span) => etiqueta(span, 'otel.scope.name') === '@opentelemetry/instrumentation-undici');
  if (cliente === undefined) {
    fallos.push('No hay ningún span de `@opentelemetry/instrumentation-undici`: `fetch` NO está instrumentado.');
  } else {
    if (etiqueta(cliente, 'span.kind') !== 'client') fallos.push(`El span saliente no es CLIENT sino ${etiqueta(cliente, 'span.kind')}.`);

    const idPadre = cliente.references.find((r) => r.refType === 'CHILD_OF')?.spanID;
    const padre = idPadre === undefined ? undefined : porId.get(idPadre);
    if (padre?.operationName !== 'negocio.llamada.externa') {
      fallos.push(`El span saliente cuelga de "${padre?.operationName ?? '(raíz)'}" y no del span de negocio: el contexto no se propagó.`);
    }

    const serializado = JSON.stringify(cliente.tags);
    if (serializado.includes('X-Amz-Signature') || serializado.includes('X-Amz-Credential')) {
      fallos.push('FUGA: la cadena de consulta con la firma aparece en los atributos del span.');
    }
    if (cliente.tags.some((t) => t.key === 'url.query')) fallos.push('FUGA: el atributo `url.query` no se borró.');
    if ((etiqueta(cliente, 'url.full') ?? '').includes('?')) fallos.push('FUGA: `url.full` conserva la cadena de consulta.');
    if (!(etiqueta(cliente, 'url.full') ?? '').endsWith(RUTA)) {
      fallos.push(`Se recortó de más: \`url.full\` es "${etiqueta(cliente, 'url.full')}" y debería conservar la ruta ${RUTA}.`);
    }
  }

  if (fallos.length > 0) {
    console.error('❌ La instrumentación de HTTP saliente NO cumple:');
    for (const fallo of fallos) console.error(`   · ${fallo}`);
    process.exitCode = 1;
    return;
  }
  console.log('✅ HTTP saliente instrumentado y saneado:');
  console.log(`   · span CLIENT de undici, colgando del span de negocio`);
  console.log(`   · url.full = ${etiqueta(cliente!, 'url.full')}  (sin la firma)`);
}

void main().catch((error: unknown) => {
  console.error('❌ La comprobación no pudo completarse:', error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
