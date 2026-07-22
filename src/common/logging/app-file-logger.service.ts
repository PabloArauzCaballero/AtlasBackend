import { ConsoleLogger } from '@nestjs/common';
import { appendFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { env } from '../../config/env.js';
import { redactSensitiveText } from '../utils/privacy/redact-text.util.js';
import { getCorrelationId, getTraceId } from './request-context.js';

function lastStringOf(params: unknown[]): string | undefined {
  const last = params.at(-1);
  return typeof last === 'string' ? last : undefined;
}

function stringifyMessage(message: unknown): string {
  if (typeof message === 'string') return message;
  if (message instanceof Error) return message.stack ?? message.message;
  try {
    return JSON.stringify(message);
  } catch {
    return String(message);
  }
}

/**
 * `ArchivoLogMongoSyncService` (`src/modules/log-sync/log-sync.service.ts`) sincroniza el
 * contenido de `LOG_SYNC_FILE_PATH` (default `Archivo.log`) hacia MongoDB, pero nada en el
 * backend escribía ese archivo — el `Logger` de Nest por defecto solo imprime a consola. Este
 * logger extiende `ConsoleLogger` (mantiene el output de CONSOLA human-readable sin cambios) y
 * además apila cada línea en `Archivo.log`, en orden, sin bloquear el event loop.
 *
 * Formato de archivo: JSON estructurado (una línea = un objeto JSON), con `correlationId` y
 * `traceId` del request en curso (vía AsyncLocalStorage / OpenTelemetry). Así cada línea es
 * parseable y correlacionable con su request y su traza — antes era texto plano sin correlación.
 * Nada parsea el formato previo (log-sync solo cuenta líneas; el visor de Mongo hace búsqueda
 * full-text sobre `content`), así que el cambio a JSON es compatible con los consumidores.
 *
 * Si `Archivo.log` no puede escribirse (permisos, disco lleno, etc.), el error se manda a
 * stderr directamente — nunca a través de `this.error(...)`, para no encolar un intento de
 * escritura que fallaría otra vez y generar un bucle.
 */
export class AppFileLogger extends ConsoleLogger {
  private readonly filePath = resolve(env.LOG_SYNC_FILE_PATH);
  private writeQueue: Promise<void> = Promise.resolve();

  private enqueueWrite(level: string, context: string | undefined, message: unknown, extra?: string): void {
    // Scrubber de PII/secretos antes de persistir: la línea acaba en Archivo.log y de ahí en la
    // colección Mongo expuesta por /systems/logs/mongo. `redactSensitiveObject` solo cubre payloads
    // estructurados; aquí el mensaje/stack ya es texto libre, así que se enmascara por patrón.
    const entry = {
      ts: new Date().toISOString(),
      level,
      context: context ?? null,
      correlationId: getCorrelationId() ?? null,
      traceId: getTraceId() ?? null,
      message: redactSensitiveText(stringifyMessage(message)),
      ...(extra ? { stack: redactSensitiveText(extra) } : {}),
    };
    const line = `${JSON.stringify(entry)}\n`;

    this.writeQueue = this.writeQueue
      .then(() => appendFile(this.filePath, line, 'utf8'))
      .catch((error: unknown) => {
        process.stderr.write(`[AppFileLogger] No se pudo escribir en ${this.filePath}: ${String(error)}\n`);
      });
  }

  override log(message: unknown, ...optionalParams: unknown[]): void {
    super.log(message as string, ...(optionalParams as [string?]));
    this.enqueueWrite('log', lastStringOf(optionalParams) ?? this.context, message);
  }

  override error(message: unknown, ...optionalParams: unknown[]): void {
    super.error(message as string, ...(optionalParams as [string?, string?]));
    const context = optionalParams.length >= 2 ? lastStringOf(optionalParams) : undefined;
    const stack = typeof optionalParams[0] === 'string' && optionalParams.length >= 2 ? (optionalParams[0] as string) : undefined;
    this.enqueueWrite('error', context ?? this.context, message, stack);
  }

  override warn(message: unknown, ...optionalParams: unknown[]): void {
    super.warn(message as string, ...(optionalParams as [string?]));
    this.enqueueWrite('warn', lastStringOf(optionalParams) ?? this.context, message);
  }

  override debug(message: unknown, ...optionalParams: unknown[]): void {
    super.debug(message as string, ...(optionalParams as [string?]));
    this.enqueueWrite('debug', lastStringOf(optionalParams) ?? this.context, message);
  }

  override verbose(message: unknown, ...optionalParams: unknown[]): void {
    super.verbose(message as string, ...(optionalParams as [string?]));
    this.enqueueWrite('verbose', lastStringOf(optionalParams) ?? this.context, message);
  }

  override fatal(message: unknown, ...optionalParams: unknown[]): void {
    super.fatal(message as string, ...(optionalParams as [string?]));
    this.enqueueWrite('fatal', lastStringOf(optionalParams) ?? this.context, message);
  }
}
