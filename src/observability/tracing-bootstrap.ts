import { Logger } from '@nestjs/common';
import { startTracing } from './tracing.js';

/**
 * Punto de arranque de trazas con efecto de importación: debe ser el PRIMER import de `main.ts`
 * (tras `reflect-metadata`) para que la auto-instrumentación de OpenTelemetry envuelva HTTP/Express/PG
 * antes de que la app los cargue. Es no-op salvo que `OTEL_ENABLED=true`.
 */
if (startTracing()) {
  new Logger('AtlasTracing').log('OpenTelemetry activado (OTEL_ENABLED=true): trazas exportándose por OTLP.');
}
