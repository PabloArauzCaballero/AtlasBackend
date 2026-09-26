/**
 * @file El archivo de log deja de intentarse tras el primer fallo, en vez de gritar en cada línea.
 * @business Un despliegue con `LOG_SYNC_FILE_PATH` mal puesto —el default `Archivo.log` es RELATIVO y
 *   cae en `/app`, que pertenece a root, mientras el proceso corre como `node`— emitía un `EACCES` a
 *   stderr POR CADA LÍNEA. Se encontró un contenedor con 62.848 fallos encadenados: ruido infinito que
 *   ahoga los logs de verdad. La consola es el canal principal en un contenedor y sigue recibiéndolo
 *   todo, así que frenar el aviso no pierde ninguna línea; la escritura se sigue intentando.
 * @system Directorio de sólo lectura real: el `appendFile` falla de verdad, no con un doble.
 *   Eso ata la primera prueba a POSIX: en Windows `chmod` sólo mueve el atributo de sólo lectura
 *   del propio directorio y no quita el permiso de crear ficheros dentro, así que el `appendFile`
 *   tiene éxito y no hay fallo que degradar. Medido: tras `chmod(dir, 0o500)` el modo queda en
 *   `444` y la escritura entra igual. Se salta ahí en vez de simular el fallo con un doble, porque
 *   lo que esta prueba defiende es justamente que el error venga del sistema de ficheros real.
 *   El contenedor de producción es Linux, que es donde la prueba tiene que valer.
 */
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { chmod, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** En Windows el directorio no se puede volver no-escribible con `chmod`. Véase la nota de `@system`. */
const soloDondeChmodMuerde = process.platform === 'win32' ? it.skip : it;

describe('AppFileLogger — degradación cuando el archivo no se puede escribir', () => {
  let directory: string;
  let errores: string[];
  let stderrSpy: jest.SpiedFunction<typeof process.stderr.write>;
  let stdoutSpy: jest.SpiedFunction<typeof process.stdout.write>;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'atlas-log-ro-'));
    errores = [];
    stderrSpy = jest.spyOn(process.stderr, 'write').mockImplementation((chunk: unknown) => {
      errores.push(String(chunk));
      return true;
    });
    stdoutSpy = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
  });

  afterEach(async () => {
    stderrSpy.mockRestore();
    stdoutSpy.mockRestore();
    await chmod(directory, 0o700).catch(() => undefined);
    await rm(directory, { recursive: true, force: true });
  });

  soloDondeChmodMuerde('avisa UNA vez aunque fallen 25 líneas seguidas', async () => {
    const logPath = join(directory, 'Archivo.log');
    process.env.LOG_SYNC_FILE_PATH = logPath;
    process.env.LOG_FORMAT = 'json';
    // Sin permiso de escritura en el directorio: `appendFile` falla como en el contenedor real.
    await chmod(directory, 0o500);

    jest.resetModules();
    const { AppFileLogger } = await import('../../../../src/common/logging/app-file-logger.service.js');
    const logger = new AppFileLogger();

    for (let i = 0; i < 25; i += 1) logger.log(`línea ${i}`, 'Prueba');
    // Se drena la cola de escritura del logger.
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setTimeout(resolve, 50));

    const avisos = errores.filter((linea) => linea.includes('[AppFileLogger] No se pudo escribir'));
    expect(avisos).toHaveLength(1);
    expect(avisos[0]).toContain('LOG_SYNC_FILE_PATH');
    expect(avisos[0]).toContain('Se sigue intentando y la consola recibe todas las líneas');
  });

  it('las líneas siguen saliendo por la consola: no se pierde ningún log', async () => {
    const logPath = join(directory, 'Archivo.log');
    process.env.LOG_SYNC_FILE_PATH = logPath;
    process.env.LOG_FORMAT = 'json';
    await chmod(directory, 0o500);

    jest.resetModules();
    const { AppFileLogger } = await import('../../../../src/common/logging/app-file-logger.service.js');
    const logger = new AppFileLogger();

    const emitidas: string[] = [];
    stdoutSpy.mockImplementation((chunk: unknown) => {
      emitidas.push(String(chunk));
      return true;
    });
    logger.log('hola', 'Prueba');
    logger.log('adiós', 'Prueba');
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(emitidas.filter((linea) => linea.includes('hola'))).toHaveLength(1);
    expect(emitidas.filter((linea) => linea.includes('adiós'))).toHaveLength(1);
  });
});
