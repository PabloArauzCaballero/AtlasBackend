import { afterEach, describe, expect, it } from '@jest/globals';
import { buildMigrationSequelizeOptions, buildReadSequelizeOptions, buildSequelizeOptions } from '../../../src/config/database.config.js';
import { env } from '../../../src/config/env.js';

/**
 * Techos de sesión de PostgreSQL.
 *
 * `REQUEST_TIMEOUT_MS` corta el Observable del request y devuelve 503, pero NO cancela la consulta:
 * el socket sigue esperando y la conexión del pool sigue ocupada. Sólo el servidor puede abortar su
 * propio trabajo, y `statement_timeout` es el mecanismo para pedírselo. Sin él, N peticiones lentas
 * agotan el pool aunque todas hayan respondido ya al cliente, y la degradación deja de ser local al
 * endpoint lento para llevarse por delante a toda la API.
 *
 * `idle_in_transaction_session_timeout` cubre el otro caso: el cliente muere entre el BEGIN y el
 * COMMIT y deja locks tomados sobre filas que nadie más puede tocar.
 *
 * `env` es un objeto plano no congelado: se muta y se restaura por prueba.
 */
describe('techos de sesión de PostgreSQL', () => {
  const mutableEnv = env as unknown as Record<string, unknown>;
  const originalEnv: Record<string, unknown> = {};

  const setEnv = (key: string, value: unknown) => {
    if (!(key in originalEnv)) originalEnv[key] = mutableEnv[key];
    mutableEnv[key] = value;
  };

  afterEach(() => {
    for (const [key, value] of Object.entries(originalEnv)) mutableEnv[key] = value;
    for (const key of Object.keys(originalEnv)) delete originalEnv[key];
  });

  const startupOptions = (options: { dialectOptions?: unknown }): string =>
    String((options.dialectOptions as { options?: string } | undefined)?.options ?? '');

  it('la conexión de escritura fija ambos techos', () => {
    setEnv('DB_STATEMENT_TIMEOUT_MS', 45_000);
    setEnv('DB_IDLE_IN_TRANSACTION_TIMEOUT_MS', 30_000);

    const options = startupOptions(buildSequelizeOptions());

    expect(options).toContain('-c statement_timeout=45000');
    expect(options).toContain('-c idle_in_transaction_session_timeout=30000');
  });

  it('la conexión de lectura hereda los mismos techos', () => {
    setEnv('DB_STATEMENT_TIMEOUT_MS', 45_000);
    setEnv('DB_IDLE_IN_TRANSACTION_TIMEOUT_MS', 30_000);

    const options = startupOptions(buildReadSequelizeOptions());

    expect(options).toContain('-c statement_timeout=45000');
    expect(options).toContain('-c idle_in_transaction_session_timeout=30000');
  });

  it('las MIGRACIONES quedan fuera: un DDL o un backfill legítimo dura más que cualquier request', () => {
    setEnv('DB_STATEMENT_TIMEOUT_MS', 45_000);
    setEnv('DB_IDLE_IN_TRANSACTION_TIMEOUT_MS', 30_000);

    const options = startupOptions(buildMigrationSequelizeOptions());

    // Matar una migración a la mitad es peor que dejarla terminar: puede quedar un esquema a medio
    // aplicar sobre el que la siguiente ejecución ya no sabe razonar.
    expect(options).not.toContain('statement_timeout');
    expect(options).not.toContain('idle_in_transaction_session_timeout');
  });

  it('con 0 no se emite el techo: es el comportamiento previo, elegido a conciencia', () => {
    setEnv('DB_STATEMENT_TIMEOUT_MS', 0);
    setEnv('DB_IDLE_IN_TRANSACTION_TIMEOUT_MS', 0);

    const options = startupOptions(buildSequelizeOptions());

    expect(options).not.toContain('statement_timeout');
    expect(options).not.toContain('idle_in_transaction_session_timeout');
  });

  it('el search_path se conserva siempre: los techos se añaden, no reemplazan', () => {
    setEnv('DB_STATEMENT_TIMEOUT_MS', 10_000);
    setEnv('DB_IDLE_IN_TRANSACTION_TIMEOUT_MS', 0);

    const write = startupOptions(buildSequelizeOptions());
    const read = startupOptions(buildReadSequelizeOptions());

    expect(write).toMatch(/^-c search_path=/);
    expect(read).toContain('-c search_path=read_api,public');
    // Con el techo de transacción inactiva en 0, solo se emite el de sentencia.
    expect(write).toContain('-c statement_timeout=10000');
    expect(write).not.toContain('idle_in_transaction_session_timeout');
  });
});
