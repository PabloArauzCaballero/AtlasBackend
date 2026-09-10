import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AppFileLogger } from '../../../src/common/logging/app-file-logger.service.js';
import { env } from '../../../src/config/env.js';

/**
 * El logger que escribe `Archivo.log`.
 *
 * Se prueba contra el sistema de archivos de verdad y no con un doble: lo que se está fijando es
 * precisamente el comportamiento en el disco —que la rotación ocurra, que el relevo sea uno solo, y
 * que un fallo de escritura no tumbe el proceso—, y un doble de `fs` sólo probaría que se llamó a
 * una función.
 *
 * Tres decisiones, todas documentadas en el propio archivo y todas fáciles de perder:
 *
 * La consola sigue el MISMO camino que el archivo. Antes sólo el archivo era JSON y sólo el archivo
 * pasaba por el redactor: en un contenedor stdout ES el pipeline de logs, así que la redacción
 * protegía el canal secundario y dejaba el principal en claro (hallazgo A-04).
 *
 * La rotación por tamaño existe porque el sincronizador a Mongo trunca el archivo SÓLO tras
 * sincronizar, y un despliegue sin Mongo —configuración soportada— no lo truncaba nunca: el archivo
 * crecía hasta llenar el disco del contenedor, y con él se cae el proceso entero, no sólo el
 * logging. Es de un solo relevo a propósito: este archivo es un búfer hacia el pipeline, no el
 * histórico; conservar más generaciones daría una falsa sensación de retención en un fichero local
 * que nadie respalda.
 *
 * Y un fallo de escritura va a stderr DIRECTAMENTE, nunca por `this.error(...)`: hacerlo encolaría
 * otro intento de escritura que fallaría igual, y eso es un bucle.
 */
type Clave = keyof typeof env;

const original = new Map<Clave, unknown>();

function poner(valores: Partial<Record<Clave, unknown>>): void {
  for (const [clave, valor] of Object.entries(valores) as Array<[Clave, unknown]>) {
    if (!original.has(clave)) original.set(clave, (env as Record<string, unknown>)[clave]);
    (env as Record<string, unknown>)[clave] = valor;
  }
}

/** Espera a que la cola de escritura del logger drene. */
async function drenar(logger: AppFileLogger): Promise<void> {
  await (logger as unknown as { writeQueue: Promise<void> }).writeQueue;
}

describe('AppFileLogger', () => {
  let carpeta: string;
  let ruta: string;
  let salida: string[];
  let errores: string[];

  beforeEach(async () => {
    carpeta = await mkdtemp(join(tmpdir(), 'atlas-log-'));
    ruta = join(carpeta, 'Archivo.log');
    salida = [];
    errores = [];
    jest.spyOn(process.stdout, 'write').mockImplementation(((texto: string) => {
      salida.push(String(texto));
      return true;
    }) as never);
    jest.spyOn(process.stderr, 'write').mockImplementation(((texto: string) => {
      errores.push(String(texto));
      return true;
    }) as never);
    poner({ LOG_SYNC_FILE_PATH: ruta, LOG_FORMAT: 'json', LOG_FILE_MAX_BYTES: 1_000_000 });
  });

  afterEach(async () => {
    for (const [clave, valor] of original) (env as Record<string, unknown>)[clave] = valor;
    original.clear();
    jest.restoreAllMocks();
    await rm(carpeta, { recursive: true, force: true });
  });

  describe('la línea', () => {
    it('es un objeto JSON por línea, con nivel, contexto y marca de tiempo', async () => {
      const logger = new AppFileLogger();
      logger.log('arrancó el módulo', 'Bootstrap');
      await drenar(logger);

      const linea = JSON.parse((await readFile(ruta, 'utf8')).trim()) as Record<string, unknown>;
      expect(linea).toMatchObject({ level: 'log', context: 'Bootstrap', message: 'arrancó el módulo' });
      expect(Date.parse(String(linea.ts))).not.toBeNaN();
      expect(linea).toHaveProperty('correlationId');
      expect(linea).toHaveProperty('traceId');
    });

    it('la CONSOLA recibe exactamente la misma línea redactada que el archivo', async () => {
      const logger = new AppFileLogger();
      logger.log('password=SuperSecreta123 en el intento de login', 'Auth');
      await drenar(logger);

      const enArchivo = (await readFile(ruta, 'utf8')).trim();
      expect(salida.join('').trim()).toBe(enArchivo);
      expect(enArchivo).not.toContain('SuperSecreta123');
    });

    it('los errores y lo fatal van por stderr, no por stdout', async () => {
      const logger = new AppFileLogger();
      logger.error('reventó');
      logger.fatal('reventó del todo');
      await drenar(logger);

      expect(errores.join('')).toContain('reventó');
      expect(salida.join('')).not.toContain('reventó');
    });

    it('un Error se guarda con su pila y no como «[object Object]»', async () => {
      const logger = new AppFileLogger();
      logger.error(new Error('boom'));
      await drenar(logger);

      const linea = JSON.parse((await readFile(ruta, 'utf8')).trim()) as { message: string };
      expect(linea.message).toContain('boom');
      expect(linea.message).not.toContain('[object Object]');
    });

    it('un objeto se serializa, y uno con ciclos no rompe el logger', async () => {
      const logger = new AppFileLogger();
      const ciclico: Record<string, unknown> = { a: 1 };
      ciclico.yo = ciclico;

      logger.log({ a: 1, b: 'dos' });
      logger.log(ciclico);
      await drenar(logger);

      const lineas = (await readFile(ruta, 'utf8'))
        .trim()
        .split('\n')
        .map((l) => JSON.parse(l) as { message: string });
      expect(lineas[0].message).toBe('{"a":1,"b":"dos"}');
      expect(lineas[1].message).toContain('[object Object]');
    });

    it('la pila de un error viaja aparte y también redactada', async () => {
      const logger = new AppFileLogger();
      logger.error('falló el login', 'Error: password=SuperSecreta123\n  at x', 'AuthService');
      await drenar(logger);

      const linea = JSON.parse((await readFile(ruta, 'utf8')).trim()) as { stack?: string; context: string };
      expect(linea.context).toBe('AuthService');
      expect(linea.stack).toBeTruthy();
      expect(linea.stack).not.toContain('SuperSecreta123');
    });

    it('los seis niveles escriben su propio nivel', async () => {
      const logger = new AppFileLogger();
      logger.log('a');
      logger.error('b');
      logger.warn('c');
      logger.debug('d');
      logger.verbose('e');
      logger.fatal('f');
      await drenar(logger);

      const niveles = (await readFile(ruta, 'utf8'))
        .trim()
        .split('\n')
        .map((l) => (JSON.parse(l) as { level: string }).level);
      expect(niveles).toEqual(['log', 'error', 'warn', 'debug', 'verbose', 'fatal']);
    });

    it('sin contexto se declara nulo y no la cadena «undefined»', async () => {
      const logger = new AppFileLogger();
      logger.log('sin contexto');
      await drenar(logger);

      expect((JSON.parse((await readFile(ruta, 'utf8')).trim()) as { context: unknown }).context).toBeNull();
    });
  });

  describe('formato de consola', () => {
    it('en modo `pretty` la consola NO recibe el JSON, pero el archivo sí', async () => {
      poner({ LOG_FORMAT: 'pretty' });
      const logger = new AppFileLogger();

      logger.log('humano', 'Dev');
      await drenar(logger);

      expect(await readFile(ruta, 'utf8')).toContain('"message":"humano"');
      expect(salida.join('')).not.toContain('"level":"log"');
    });
  });

  describe('rotación por tamaño', () => {
    it('un solo relevo: `Archivo.log.1`, y el activo empieza de cero', async () => {
      poner({ LOG_FILE_MAX_BYTES: 200 });
      await writeFile(ruta, 'x'.repeat(190), 'utf8');
      const logger = new AppFileLogger();

      logger.log('la línea que desborda el tope y provoca el relevo');
      await drenar(logger);

      const rotado = await readFile(`${ruta}.1`, 'utf8');
      const activo = await readFile(ruta, 'utf8');
      expect(rotado).toBe('x'.repeat(190));
      expect(activo).toContain('provoca el relevo');
      expect(activo.trim().split('\n')).toHaveLength(1);
    });

    it('no rota mientras cabe: el `stat` se hace una vez y luego se lleva la cuenta', async () => {
      poner({ LOG_FILE_MAX_BYTES: 1_000_000 });
      const logger = new AppFileLogger();

      logger.log('una');
      logger.log('dos');
      logger.log('tres');
      await drenar(logger);

      expect((await readFile(ruta, 'utf8')).trim().split('\n')).toHaveLength(3);
      await expect(readFile(`${ruta}.1`, 'utf8')).rejects.toThrow();
    });

    it('rotar dos veces conserva sólo el último relevo: es un búfer, no el histórico', async () => {
      poner({ LOG_FILE_MAX_BYTES: 120 });
      const logger = new AppFileLogger();

      logger.log('primera tanda de mensajes que ocupa lo suyo en el archivo');
      logger.log('segunda tanda de mensajes que vuelve a desbordar el tope');
      logger.log('tercera tanda');
      await drenar(logger);

      const rotado = await readFile(`${ruta}.1`, 'utf8');
      expect(rotado).toContain('segunda tanda');
      expect(rotado).not.toContain('primera tanda');
    });

    it('si la rotación falla se sigue escribiendo: perderla es preferible a perder las líneas', async () => {
      poner({ LOG_FILE_MAX_BYTES: 50, LOG_SYNC_FILE_PATH: join(carpeta, 'sin-carpeta', 'Archivo.log') });
      const logger = new AppFileLogger();

      logger.log('esta línea desborda el tope desde el primer momento');
      await drenar(logger);

      expect(errores.join('')).toContain('[AppFileLogger]');
    });
  });

  describe('fallo de escritura', () => {
    it('va a stderr directamente y NO por `this.error`, que encolaría otro intento fallido', async () => {
      poner({ LOG_SYNC_FILE_PATH: join(carpeta, 'no', 'existe', 'Archivo.log') });
      const logger = new AppFileLogger();
      const espia = jest.spyOn(logger, 'error');

      logger.log('esto no se puede escribir');
      await drenar(logger);

      expect(errores.join('')).toContain('No se pudo escribir');
      expect(espia).not.toHaveBeenCalled();
    });

    it('el proceso sigue vivo y las líneas siguientes se siguen intentando', async () => {
      poner({ LOG_SYNC_FILE_PATH: join(carpeta, 'no', 'existe', 'Archivo.log') });
      const logger = new AppFileLogger();

      logger.log('una');
      logger.log('dos');
      await expect(drenar(logger)).resolves.toBeUndefined();
      expect(errores.filter((linea) => linea.includes('No se pudo escribir'))).toHaveLength(2);
    });
  });
});
