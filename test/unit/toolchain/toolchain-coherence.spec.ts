import { describe, expect, it, jest } from '@jest/globals';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Coherencia de la cadena de herramientas. El 2026-09-28 dos actualizaciones automáticas rompieron
 * `dev` sin que ningún gate lo viera antes de fusionar: typescript 7 (#91) quitó la API que usan
 * ts-jest y typescript-eslint, y @nestjs/sequelize 12 (#93) se publica sólo como módulo ES, que Jest
 * no carga en CommonJS («Must use import to load ES Module»): 396 suites sin poder arrancar.
 *
 * Esta prueba fija, en un sitio, qué versiones mayores van juntas. Corre dentro de `test:unit`, así
 * que no depende de que alguien recuerde un paso de CI. Cuando el repo migre (Nest 12 + pruebas ESM),
 * se actualiza la tabla en el MISMO PR que la migración, con su motivo.
 */
const root = resolve(process.cwd());
const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')) as {
  dependencies: Record<string, string>;
  devDependencies: Record<string, string>;
  engines?: { node?: string };
};
const declared = { ...pkg.dependencies, ...pkg.devDependencies };

/** Versión instalada de verdad (la del árbol `node_modules`), no la del rango declarado. */
function installedMajor(name: string): number {
  const json = JSON.parse(readFileSync(resolve(root, 'node_modules', name, 'package.json'), 'utf8')) as { version: string };
  return Number(json.version.split('.')[0]);
}

const ESPERADO: Array<[nombre: string, major: number, motivo: string]> = [
  ['@nestjs/core', 11, 'el framework de producción'],
  ['@nestjs/common', 11, 'debe ir con @nestjs/core'],
  ['@nestjs/platform-express', 11, 'debe ir con @nestjs/core'],
  ['@nestjs/testing', 11, 'debe ir con @nestjs/core (#101 revirtió el salto a 12)'],
  ['@nestjs/sequelize', 11, 'la 12 es ESM puro y Jest (CJS) no la carga (#93 → #103)'],
  ['typescript', 5, 'la 7 quita la API de compilador que usan ts-jest y typescript-eslint (#91 → #101)'],
  ['ts-jest', 29, 'compilador de las pruebas; su major va atado a jest y a typescript'],
  ['jest', 30, 'runner; ts-jest 29 lo soporta'],
];

describe('cadena de herramientas coherente', () => {
  it.each(ESPERADO)('%s instalado es major %i (%s)', (nombre, major) => {
    expect(installedMajor(nombre)).toBe(major);
  });

  // `@nestjs/config` y `@nestjs/throttler` llevan su propio ciclo de versiones (4.x y 6.x sobre
  // Nest 11); la familia que SÍ tiene que ir a la par es la del núcleo.
  it('la familia del núcleo de Nest comparte major', () => {
    const familia = [
      '@nestjs/core',
      '@nestjs/common',
      '@nestjs/platform-express',
      '@nestjs/testing',
      '@nestjs/sequelize',
      '@nestjs/swagger',
    ];
    const majors = new Set(familia.filter((n) => n in declared).map((n) => installedMajor(n)));
    expect([...majors]).toEqual([11]);
  });

  it('@nestjs/sequelize sigue siendo cargable desde CommonJS (la regresión de #93)', () => {
    // Si el paquete pasa a ESM puro, `require` lanza ERR_REQUIRE_ESM antes de que 396 suites
    // fallen una a una con «Must use import to load ES Module».
    expect(() => jest.requireActual('@nestjs/sequelize')).not.toThrow();
  });

  it('engines.node exige la línea que corre en CI y en Coolify', () => {
    expect(pkg.engines?.node).toMatch(/^>=22/);
    expect(Number(process.versions.node.split('.')[0])).toBeGreaterThanOrEqual(22);
  });
});
