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
 * SEGUNDA FASE, opcional: con `VERIFY_OUTBOUND_HTTPS_URL` apuntando a un destino HTTPS real, se
 * repite la comprobación sobre una llamada con TLS y resolución DNS de verdad. Es opcional a
 * propósito: la primera fase tiene que poder correr sin red, y una comprobación que sólo funciona
 * con conectividad se acaba desactivando. El destino por defecto sugerido es la propia API de
 * Atlas por Tailscale, que es infraestructura nuestra y no un tercero.
 *
 * Lo que NO cubre ni con la segunda fase: el comportamiento de un proveedor externo concreto
 * —sus tiempos, sus redirecciones, sus errores—, que sólo se ve integrando con él.
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
  const spans = await buscarSpans(SERVICIO);
  verificar(spans, RUTA, 'servidor local (HTTP, sin DNS)');

  const destinoTls = process.env.VERIFY_OUTBOUND_HTTPS_URL;
  if (destinoTls === undefined || destinoTls.trim() === '') {
    console.log('ℹ️  Segunda fase omitida: declara VERIFY_OUTBOUND_HTTPS_URL para comprobar TLS y DNS reales.');
    return;
  }
  await verificarConTls(destinoTls.trim());
}

/**
 * Misma comprobación sobre una llamada HTTPS real: TLS y resolución DNS de verdad.
 *
 * Se usa un servicio y una traza nuevos para no mezclar con la fase local. La URL lleva también
 * una cadena de consulta con forma de firma: el saneado tiene que actuar igual, y en una llamada
 * a un almacén de objetos remoto es justo donde importa.
 */
async function verificarConTls(base: string): Promise<void> {
  const { context, trace } = await import('@opentelemetry/api');
  const url = new URL(base);
  url.searchParams.set('X-Amz-Signature', 'firma-que-no-debe-salir');
  url.searchParams.set('X-Amz-Credential', 'credencial-que-no-debe-salir');

  process.env.OTEL_SERVICE_NAME = `${SERVICIO}-tls`;
  startTracing(`${SERVICIO}-tls`);
  const padre = trace.getTracer('verificacion').startSpan('negocio.llamada.externa.tls');
  let alcanzado = true;
  await context.with(trace.setSpan(context.active(), padre), async () => {
    try {
      const respuesta = await fetch(url.toString(), { signal: AbortSignal.timeout(15_000) });
      await respuesta.text();
      console.log(`   (el destino respondió ${respuesta.status}; el código no importa, el span sí)`);
    } catch (error) {
      alcanzado = false;
      console.error(`❌ No se pudo alcanzar ${url.origin}: ${error instanceof Error ? error.message : error}`);
    }
  });
  padre.end();
  await stopTracing();
  if (!alcanzado) {
    process.exitCode = 1;
    return;
  }
  const spans = await buscarSpans(`${SERVICIO}-tls`);
  verificar(spans, url.pathname, `${url.origin} (HTTPS, con TLS y DNS)`);
}

async function buscarSpans(servicio: string): Promise<SpanJaeger[]> {
  for (let intento = 1; intento <= 10; intento += 1) {
    await esperar(1000);
    const respuesta = await fetch(`${consultaJaeger()}/api/traces?service=${servicio}&limit=1&lookback=5m`);
    if (!respuesta.ok) continue;
    const cuerpo = (await respuesta.json()) as { data: { spans: SpanJaeger[] }[] };
    const traza = cuerpo.data[0];
    if (traza !== undefined && traza.spans.length >= 2) return traza.spans;
  }
  throw new Error(`No llegó ninguna traza de "${servicio}" a ${consultaJaeger()}. ¿Está Jaeger levantado (yarn jaeger:up)?`);
}

function verificar(spans: SpanJaeger[], rutaEsperada: string, descripcion: string): void {
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
    if (!(padre?.operationName ?? '').startsWith('negocio.llamada.externa')) {
      fallos.push(`El span saliente cuelga de "${padre?.operationName ?? '(raíz)'}" y no del span de negocio: el contexto no se propagó.`);
    }

    const serializado = JSON.stringify(cliente.tags);
    if (serializado.includes('X-Amz-Signature') || serializado.includes('X-Amz-Credential')) {
      fallos.push('FUGA: la cadena de consulta con la firma aparece en los atributos del span.');
    }
    if (cliente.tags.some((t) => t.key === 'url.query')) fallos.push('FUGA: el atributo `url.query` no se borró.');
    if ((etiqueta(cliente, 'url.full') ?? '').includes('?')) fallos.push('FUGA: `url.full` conserva la cadena de consulta.');
    if (!(etiqueta(cliente, 'url.full') ?? '').endsWith(rutaEsperada)) {
      fallos.push(`Se recortó de más: \`url.full\` es "${etiqueta(cliente, 'url.full')}" y debería conservar la ruta ${rutaEsperada}.`);
    }
  }

  if (fallos.length > 0) {
    console.error(`❌ La instrumentación de HTTP saliente NO cumple contra ${descripcion}:`);
    for (const fallo of fallos) console.error(`   · ${fallo}`);
    process.exitCode = 1;
    return;
  }
  console.log(`✅ HTTP saliente instrumentado y saneado contra ${descripcion}:`);
  console.log(`   · span CLIENT de undici, colgando del span de negocio`);
  console.log(`   · url.full = ${etiqueta(cliente!, 'url.full')}  (sin la firma)`);
}

void main().catch((error: unknown) => {
  console.error('❌ La comprobación no pudo completarse:', error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
