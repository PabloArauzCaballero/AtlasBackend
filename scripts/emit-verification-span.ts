/**
 * @file Emite UNA traza de prueba con el arranque real del backend y escribe su trace_id.
 * @business Esta pieza reduce el tiempo de detección y recuperación de incidentes.
 * @system lo usa `scripts/verify-jaeger.sh`: exporta por OTLP y deja el identificador en stdout.
 */
import { SpanStatusCode, trace } from '@opentelemetry/api';
import { startTracing, stopTracing } from '../src/observability/tracing.js';

/**
 * Usa el MISMO arranque que la aplicación, no un SDK improvisado: si la configuración del
 * repositorio está mal —endpoint, propagadores, muestreo—, esta comprobación tiene que fallar
 * igual que fallaría en producción. Un guion con su propio `NodeSDK` daría un verde que no
 * dice nada del backend.
 */
async function main(): Promise<void> {
  const serviceName = process.env.OTEL_SERVICE_NAME ?? 'atlas-verify';
  const operation = process.env.VERIFY_OPERATION ?? 'verify.jaeger';

  if (!startTracing(serviceName)) {
    process.stderr.write('El SDK no arrancó: hace falta OTEL_ENABLED=true.\n');
    process.exitCode = 1;
    return;
  }

  const span = trace.getTracer('verify').startSpan(operation);
  span.setAttribute('app.module', 'verificacion');
  span.setAttribute('app.operation', 'verify');
  span.setStatus({ code: SpanStatusCode.OK });
  const traceId = span.spanContext().traceId;
  span.end();

  // El cierre vacía el lote pendiente: sin esperarlo, el proceso podría terminar antes de que
  // el exportador hubiera enviado nada y la comprobación fallaría por una carrera, no por un fallo.
  await stopTracing();
  process.stdout.write(traceId);
}

void main();
