import { describe, expect, it } from '@jest/globals';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { assertDecoratorMetadataIsAvailable, hasDecoratorMetadata } from '../../../src/common/bootstrap/decorator-metadata.guard.js';

/**
 * Este guard existe por una avería concreta y cara de diagnosticar: arrancar la API con `tsx` deja
 * al contenedor sin `design:paramtypes`, y Nest muere con
 *
 *   Nest can't resolve dependencies of the RuntimeMaintenanceJobsService (…, ?, +, +, +)
 *
 * que culpa a un módulo perfectamente cableado. Se buscan ciclos de imports inexistentes durante
 * horas. Las pruebas fijan las dos mitades de la defensa: el guard, y el gate que impide volver a
 * publicar un script así.
 */
describe('guard de metadata de decoradores', () => {
  it('deja pasar cuando el runtime conserva los tipos', () => {
    expect(() => assertDecoratorMetadataIsAvailable(true)).not.toThrow();
  });

  it('corta cuando no hay metadata, nombrando la causa y la salida', () => {
    expect(() => assertDecoratorMetadataIsAvailable(false)).toThrow(/tsx/);
    expect(() => assertDecoratorMetadataIsAvailable(false)).toThrow(/yarn start:dev/);
  });

  /**
   * Este repositorio ejecuta las pruebas con ts-jest en modo `isolatedModules`, que transpila sin
   * información de tipos y por tanto TAMPOCO emite metadata. Se fija como hecho conocido: si algún
   * día deja de ser cierto, el runtime de pruebas habrá pasado a parecerse al de producción y esta
   * prueba obliga a enterarse en vez de descubrirlo por casualidad.
   */
  it('documenta que el runtime de pruebas no emite metadata (por eso el guard vive en el arranque)', () => {
    expect(hasDecoratorMetadata()).toBe(false);
  });

  it('los dos puntos de entrada (API y worker) lo invocan antes de construir el contenedor', () => {
    for (const entrypoint of ['src/main.ts', 'src/worker.ts']) {
      const source = readFileSync(resolve(process.cwd(), entrypoint), 'utf8');
      expect(source).toContain('assertDecoratorMetadataIsAvailable()');
      expect(source.indexOf('assertDecoratorMetadataIsAvailable()')).toBeLessThan(source.indexOf('NestFactory.create'));
    }
  });
});

describe('gate de puntos de entrada de Nest', () => {
  const gate = resolve(process.cwd(), 'scripts/check-nest-entrypoints.ts');

  function runGate(packageJson?: Record<string, unknown>): { status: number; output: string } {
    try {
      const output = execFileSync('node', ['--import', 'tsx', gate], {
        encoding: 'utf8',
        env: { ...process.env, ...(packageJson ? { ATLAS_GATE_FIXTURE: JSON.stringify(packageJson) } : {}) },
      });
      return { status: 0, output };
    } catch (error) {
      const failure = error as { status?: number; stdout?: string; stderr?: string };
      return { status: failure.status ?? 1, output: `${failure.stdout ?? ''}${failure.stderr ?? ''}` };
    }
  }

  it('aprueba el package.json real', () => {
    const result = runGate();
    expect(result.status).toBe(0);
    expect(result.output).toContain('ninguno se arranca con un transpilador');
  });

  it('rechaza un script que arranque la API con tsx', () => {
    const result = runGate({ scripts: { 'start:dev:tsx': 'tsx watch src/main.ts' } });
    expect(result.status).toBe(1);
    expect(result.output).toContain('start:dev:tsx');
    expect(result.output).toContain('borra la metadata');
  });
});
