import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { env } from '../../../../src/config/env.js';
import { runWithRequestContext } from '../../../../src/common/logging/request-context.js';

/**
 * Hallazgo A-04 de `docs/audit/auditoria-integral-2026-07-30.md`: `AppFileLogger` redactaba la PII
 * del ARCHIVO pero antes llamaba a `super.log(...)`, que imprimía el mensaje CRUDO por stdout. En un
 * contenedor stdout ES el pipeline de logs, así que la redacción protegía el canal secundario y
 * dejaba el principal en claro; además la consola era texto humano, sin `correlationId` ni `traceId`,
 * así que los logs recolectados no eran ni parseables ni correlacionables.
 *
 * El logger se importa de forma DINÁMICA en cada prueba porque `filePath` y `jsonConsole` se
 * resuelven al construir la instancia a partir de `env`, y aquí hace falta variarlos.
 */
describe('AppFileLogger', () => {
  const mutableEnv = env as unknown as Record<string, unknown>;
  const originalEnv: Record<string, unknown> = {};

  const setEnv = (key: string, value: unknown) => {
    if (!(key in originalEnv)) originalEnv[key] = mutableEnv[key];
    mutableEnv[key] = value;
  };

  afterEach(() => {
    for (const [key, value] of Object.entries(originalEnv)) mutableEnv[key] = value;
    for (const key of Object.keys(originalEnv)) delete originalEnv[key];
    jest.restoreAllMocks();
  });

  async function buildLogger(format: 'json' | 'pretty') {
    const logPath = join(mkdtempSync(join(tmpdir(), 'atlas-log-')), 'Archivo.log');
    setEnv('LOG_SYNC_FILE_PATH', logPath);
    setEnv('LOG_FORMAT', format);
    const { AppFileLogger } = await import('../../../../src/common/logging/app-file-logger.service.js');
    return { logger: new AppFileLogger(), logPath };
  }

  /**
   * Espera a la cola de escritura interna del logger. Un `setImmediate` no basta: `enqueueWrite`
   * encadena promesas, así que el archivo puede no existir todavía cuando el event loop da una vuelta.
   */
  const flush = (logger: unknown) => (logger as { writeQueue: Promise<void> }).writeQueue;

  it('en modo json escribe una línea JSON por stdout, no texto humano', async () => {
    const { logger } = await buildLogger('json');
    const stdout = jest.spyOn(process.stdout, 'write').mockReturnValue(true);

    logger.log('arranque completado', 'Bootstrap');

    expect(stdout).toHaveBeenCalledTimes(1);
    const entry = JSON.parse(String(stdout.mock.calls[0][0])) as Record<string, unknown>;
    expect(entry.level).toBe('log');
    expect(entry.context).toBe('Bootstrap');
    expect(entry.message).toBe('arranque completado');
    expect(typeof entry.ts).toBe('string');
  });

  it('la MISMA redacción de PII se aplica a stdout, no solo al archivo', async () => {
    const { logger, logPath } = await buildLogger('json');
    const stdout = jest.spyOn(process.stdout, 'write').mockReturnValue(true);

    logger.log('login de juan.perez@example.com con password=SuperSecreta1!', 'Auth');
    await flush(logger);

    const consoleLine = String(stdout.mock.calls[0][0]);
    expect(consoleLine).not.toContain('juan.perez@example.com');
    expect(consoleLine).not.toContain('SuperSecreta1!');
    expect(consoleLine).toContain('[REDACTED_EMAIL]');

    const fileLine = readFileSync(logPath, 'utf8');
    expect(fileLine).not.toContain('juan.perez@example.com');
    expect(JSON.parse(fileLine).message).toBe(JSON.parse(consoleLine).message);
  });

  it('incluye el correlationId del request en curso', async () => {
    const { logger } = await buildLogger('json');
    const stdout = jest.spyOn(process.stdout, 'write').mockReturnValue(true);

    runWithRequestContext({ correlationId: 'corr-abc' }, () => logger.log('dentro del request', 'Ctx'));

    expect(JSON.parse(String(stdout.mock.calls[0][0])).correlationId).toBe('corr-abc');
  });

  it('los errores van a stderr, no a stdout, y llevan el stack redactado', async () => {
    const { logger } = await buildLogger('json');
    const stdout = jest.spyOn(process.stdout, 'write').mockReturnValue(true);
    const stderr = jest.spyOn(process.stderr, 'write').mockReturnValue(true);

    logger.error('fallo al notificar', 'Error: token=abc123\n  at algo', 'Notifier');

    expect(stdout).not.toHaveBeenCalled();
    const entry = JSON.parse(String(stderr.mock.calls[0][0])) as Record<string, string>;
    expect(entry.level).toBe('error');
    expect(entry.context).toBe('Notifier');
    expect(entry.stack).toContain('[REDACTED]');
    expect(entry.stack).not.toContain('abc123');
  });

  it('en modo pretty conserva el formato humano de ConsoleLogger y sigue escribiendo el archivo', async () => {
    const { logger, logPath } = await buildLogger('pretty');
    const stdout = jest.spyOn(process.stdout, 'write').mockReturnValue(true);

    logger.log('mensaje humano', 'Dev');
    await flush(logger);

    // ConsoleLogger escribe con colores y prefijo [Nest]; lo que importa es que NO sea nuestra línea JSON.
    const printed = stdout.mock.calls.map((call) => String(call[0])).join('');
    expect(printed).toContain('mensaje humano');
    expect(() => JSON.parse(printed)).toThrow();

    expect(JSON.parse(readFileSync(logPath, 'utf8')).message).toBe('mensaje humano');
  });
});
