/**
 * Arnés de trazado para pruebas: exportador EN MEMORIA, sin red y sin Jaeger.
 *
 * Una prueba unitaria que necesitara un colector levantado no sería una prueba unitaria: sería
 * una prueba de integración disfrazada, y fallaría por motivos que no tienen que ver con lo que
 * afirma. Aquí los spans se recogen en una lista y se comprueban como datos.
 */
import { context, propagation, trace } from '@opentelemetry/api';
import { AsyncLocalStorageContextManager } from '@opentelemetry/context-async-hooks';
import { CompositePropagator, W3CBaggagePropagator, W3CTraceContextPropagator } from '@opentelemetry/core';
import { BasicTracerProvider, InMemorySpanExporter, SimpleSpanProcessor, type ReadableSpan } from '@opentelemetry/sdk-trace-base';

export type TracingHarness = {
  readonly exporter: InMemorySpanExporter;
  spans(): ReadableSpan[];
  spanNamed(name: string): ReadableSpan | undefined;
  reset(): void;
  shutdown(): Promise<void>;
};

export function installInMemoryTracing(): TracingHarness {
  const exporter = new InMemorySpanExporter();
  const provider = new BasicTracerProvider({ spanProcessors: [new SimpleSpanProcessor(exporter)] });
  // El gestor de contexto es OBLIGATORIO: sin él `startActiveSpan` no propaga el span a las
  // continuaciones asíncronas y toda relación padre-hijo se pierde en silencio.
  context.setGlobalContextManager(new AsyncLocalStorageContextManager().enable());
  trace.setGlobalTracerProvider(provider);
  propagation.setGlobalPropagator(new CompositePropagator({ propagators: [new W3CTraceContextPropagator(), new W3CBaggagePropagator()] }));

  return {
    exporter,
    spans: () => exporter.getFinishedSpans(),
    spanNamed: (name: string) => exporter.getFinishedSpans().find((span) => span.name === name),
    reset: () => exporter.reset(),
    shutdown: async () => {
      await provider.shutdown();
      trace.disable();
      context.disable();
      propagation.disable();
    },
  };
}
