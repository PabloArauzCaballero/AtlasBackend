import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * ATLAS-OPS-012 — rotación por tamaño de `Archivo.log`.
 *
 * `ArchivoLogMongoSyncService` trunca el archivo, pero SOLO tras volcarlo a MongoDB. En un
 * despliegue sin Mongo —configuración soportada— nada lo truncaba nunca y crecía hasta llenar el
 * disco del contenedor; y cuando se llena el disco no se cae el logging, se cae el proceso.
 *
 * El logger lee `env.LOG_FILE_MAX_BYTES` al construirse a través del módulo de configuración, así
 * que el tamaño de corte se fija con la variable ANTES de importarlo. Por eso el import es dinámico
 * y el módulo se aísla en cada prueba.
 */
describe('AppFileLogger — rotación por tamaño', () => {
  let directory: string;
  let logPath: string;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'atlas-log-'));
    logPath = join(directory, 'Archivo.log');
  });

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  async function buildLogger(maxBytes: number) {
    process.env.LOG_SYNC_FILE_PATH = logPath;
    process.env.LOG_FILE_MAX_BYTES = String(maxBytes);
    process.env.LOG_FORMAT = 'json';

    jest.resetModules();
    const { AppFileLogger } = await import('../../../../src/common/logging/app-file-logger.service.js');
    return new AppFileLogger();
  }

  /**
   * Espera a que la escritura encolada por el logger haya llegado al disco.
   *
   * Antes esto era un `setTimeout` de 50 ms fijo, y con eso la prueba era una apuesta: aislada
   * sobraba tiempo, pero con la suite completa repartida entre workers la escritura a veces no
   * había aterrizado y fallaba sin que nada del logger hubiera cambiado. Un fallo intermitente es
   * peor que ninguno, porque enseña a relanzar en vez de a mirar.
   *
   * Sondear la condición REAL lo vuelve determinista por los dos lados: termina en cuanto se
   * cumple —así que la suite no paga los 50 ms— y sólo falla si de verdad no ocurre.
   */
  async function esperarA(condicion: () => Promise<boolean>, timeoutMs = 5_000): Promise<void> {
    const limite = Date.now() + timeoutMs;
    for (;;) {
      if (await condicion()) return;
      if (Date.now() > limite) {
        throw new Error('La escritura del logger no llegó al disco dentro del plazo.');
      }
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }

  /** Contenido del log activo, o cadena vacía si todavía no existe. */
  const activo = (): Promise<string> => readFile(logPath, 'utf8').catch(() => '');

  it('rota a <archivo>.1 al superar el techo y sigue escribiendo en el archivo activo', async () => {
    // 1 MiB es el mínimo que admite el esquema; se pre-llena para quedar justo por debajo.
    const maxBytes = 1_048_576;
    await writeFile(logPath, 'x'.repeat(maxBytes - 10), 'utf8');

    const logger = await buildLogger(maxBytes);
    logger.log('linea que cruza el techo');
    await esperarA(async () => (await activo()).includes('linea que cruza el techo'));

    const rotated = await stat(`${logPath}.1`);
    expect(rotated.size).toBe(maxBytes - 10);

    const active = await readFile(logPath, 'utf8');
    expect(active).toContain('linea que cruza el techo');
    // El activo arranca de cero: contiene solo lo escrito tras rotar.
    expect(active.length).toBeLessThan(1_000);
  });

  it('no rota mientras el archivo cabe bajo el techo', async () => {
    const logger = await buildLogger(1_048_576);
    logger.log('primera');
    logger.log('segunda');
    // Se espera a que las DOS estén escritas: sin eso, comprobar que no hay rotación podría pasar
    // simplemente porque todavía no se había escrito nada.
    await esperarA(async () => {
      const contenido = await activo();
      return contenido.includes('primera') && contenido.includes('segunda');
    });

    await expect(stat(`${logPath}.1`)).rejects.toThrow();
    const active = await readFile(logPath, 'utf8');
    expect(active).toContain('primera');
    expect(active).toContain('segunda');
  });
});
