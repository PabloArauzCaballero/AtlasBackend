/**
 * @file Servicio de aplicación o dominio: ejecuta reglas y coordina dependencias.
 * @business Esta pieza aplica controles coherentes a todos los dominios y reduce fallas repetidas entre equipos.
 * @system provee infraestructura transversal de logging sin introducir reglas de un dominio específico.
 */
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

type LogLevel = 'log' | 'error' | 'warn' | 'debug' | 'verbose' | 'fatal';

/**
 * `ArchivoLogMongoSyncService` (`src/modules/log-sync/log-sync.service.ts`) sincroniza el
 * contenido de `LOG_SYNC_FILE_PATH` (default `Archivo.log`) hacia MongoDB, pero nada en el
 * backend escribía ese archivo — el `Logger` de Nest por defecto solo imprime a consola. Este
 * logger extiende `ConsoleLogger` y además apila cada línea en `Archivo.log`, en orden, sin
 * bloquear el event loop.
 *
 * Formato: JSON estructurado (una línea = un objeto JSON), con `correlationId` y `traceId` del
 * request en curso (vía AsyncLocalStorage / OpenTelemetry). Así cada línea es parseable y
 * correlacionable con su request y su traza.
 *
 * **La consola sigue el mismo camino que el archivo** (hallazgo A-04 de
 * `docs/audit/auditoria-integral-2026-07-30.md`). Antes solo el ARCHIVO era JSON y solo el ARCHIVO
 * pasaba por `redactSensitiveText`: la llamada a `super.log(...)` imprimía el mensaje crudo por
 * stdout. En un contenedor, stdout ES el pipeline de logs (Docker/K8s → agregador), así que la
 * redacción protegía el canal secundario y dejaba el principal en claro, y los logs recolectados no
 * eran ni parseables ni correlacionables. Con `LOG_FORMAT=json` (el default en producción) stdout
 * recibe exactamente la misma línea redactada que el archivo; con `pretty` se conserva el formato
 * humano de `ConsoleLogger` para desarrollo.
 *
 * Si `Archivo.log` no puede escribirse (permisos, disco lleno, etc.), el error se manda a
 * stderr directamente — nunca a través de `this.error(...)`, para no encolar un intento de
 * escritura que fallaría otra vez y generar un bucle.
 */
export class AppFileLogger extends ConsoleLogger {
  private readonly filePath = resolve(env.LOG_SYNC_FILE_PATH);
  private readonly jsonConsole = (env.LOG_FORMAT ?? (env.NODE_ENV === 'production' ? 'json' : 'pretty')) === 'json';
  private writeQueue: Promise<void> = Promise.resolve();

  private buildLine(level: LogLevel, context: string | undefined, message: unknown, extra?: string): string {
    // Scrubber de PII/secretos antes de emitir: la línea acaba en stdout y en Archivo.log, y de ahí
    // en la colección Mongo expuesta por /systems/logs/mongo. `redactSensitiveObject` solo cubre
    // payloads estructurados; aquí el mensaje/stack ya es texto libre, así que se enmascara por
    // patrón.
    const entry = {
      ts: new Date().toISOString(),
      level,
      context: context ?? null,
      correlationId: getCorrelationId() ?? null,
      traceId: getTraceId() ?? null,
      message: redactSensitiveText(stringifyMessage(message)),
      ...(extra ? { stack: redactSensitiveText(extra) } : {}),
    };
    return `${JSON.stringify(entry)}\n`;
  }

  private enqueueWrite(line: string): void {
    this.writeQueue = this.writeQueue
      .then(() => appendFile(this.filePath, line, 'utf8'))
      .catch((error: unknown) => {
        process.stderr.write(`[AppFileLogger] No se pudo escribir en ${this.filePath}: ${String(error)}\n`);
      });
  }

  /**
   * Único punto de emisión: construye la línea una vez y la manda al archivo y a la consola. En modo
   * `json` la consola recibe esa misma línea (redactada); en `pretty`, el emisor delega en
   * `ConsoleLogger` a través de `printPretty`.
   */
  private emit(level: LogLevel, context: string | undefined, message: unknown, printPretty: () => void, extra?: string): void {
    const line = this.buildLine(level, context, message, extra);
    if (this.jsonConsole) {
      const stream = level === 'error' || level === 'fatal' ? process.stderr : process.stdout;
      stream.write(line);
    } else {
      printPretty();
    }
    this.enqueueWrite(line);
  }

  override log(message: unknown, ...optionalParams: unknown[]): void {
    this.emit('log', lastStringOf(optionalParams) ?? this.context, message, () =>
      super.log(message as string, ...(optionalParams as [string?])),
    );
  }

  override error(message: unknown, ...optionalParams: unknown[]): void {
    const context = optionalParams.length >= 2 ? lastStringOf(optionalParams) : undefined;
    const stack = typeof optionalParams[0] === 'string' && optionalParams.length >= 2 ? (optionalParams[0] as string) : undefined;
    this.emit(
      'error',
      context ?? this.context,
      message,
      () => super.error(message as string, ...(optionalParams as [string?, string?])),
      stack,
    );
  }

  override warn(message: unknown, ...optionalParams: unknown[]): void {
    this.emit('warn', lastStringOf(optionalParams) ?? this.context, message, () =>
      super.warn(message as string, ...(optionalParams as [string?])),
    );
  }

  override debug(message: unknown, ...optionalParams: unknown[]): void {
    this.emit('debug', lastStringOf(optionalParams) ?? this.context, message, () =>
      super.debug(message as string, ...(optionalParams as [string?])),
    );
  }

  override verbose(message: unknown, ...optionalParams: unknown[]): void {
    this.emit('verbose', lastStringOf(optionalParams) ?? this.context, message, () =>
      super.verbose(message as string, ...(optionalParams as [string?])),
    );
  }

  override fatal(message: unknown, ...optionalParams: unknown[]): void {
    this.emit('fatal', lastStringOf(optionalParams) ?? this.context, message, () =>
      super.fatal(message as string, ...(optionalParams as [string?])),
    );
  }
}
