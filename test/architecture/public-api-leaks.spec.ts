/**
 * @file AT-051 — lo público de cada contexto no filtra el ORM ni el framework; los umbrales críticos
 *   de cobertura siguen apuntando a directorios que existen.
 * @business Un puerto que recibe una `Transaction` de Sequelize o exporta un modelo obliga al futuro
 *   servicio a compartir la base; un umbral de cobertura que apunta a un directorio movido deja de
 *   medir sin avisar.
 * @system Lee las fuentes de `public/`, `application/ports/` y `src/platform/contracts|events|jobs`
 *   y rechaza importaciones (también `import type`) de `sequelize`, `sequelize-typescript`,
 *   `database/models`, repositorios e infraestructura; `@nestjs/*` sólo se admite en la lista
 *   explícita de excepciones. Lee `jest.config.cjs` y comprueba que cada directorio con umbral propio
 *   contiene código fuente.
 */
import { describe, expect, it } from '@jest/globals';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = join(__dirname, '..', '..');
const SRC = join(ROOT, 'src');

/** Superficies públicas: lo que otro contexto (o un servicio) puede importar o implementar. */
function publicSurfaces(): string[] {
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const path = join(dir, entry);
      if (statSync(path).isDirectory()) walk(path);
      else if (entry.endsWith('.ts') && !entry.endsWith('.spec.ts')) files.push(path);
    }
  };
  for (const module of readdirSync(join(SRC, 'modules'))) {
    for (const surface of ['public', join('application', 'ports')]) {
      const dir = join(SRC, 'modules', module, surface);
      try {
        if (statSync(dir).isDirectory()) walk(dir);
      } catch {
        // el módulo no tiene esa superficie: nada que comprobar
      }
    }
  }
  walk(join(SRC, 'platform', 'contracts'));
  for (const dir of ['events', 'jobs']) {
    for (const entry of readdirSync(join(SRC, 'platform', dir))) {
      if (entry.endsWith('.port.ts')) files.push(join(SRC, 'platform', dir, entry));
    }
  }
  return files;
}

const LEAK = /^(sequelize|sequelize-typescript|pg)$|database\/models|\.repository\.js$|\/infrastructure\//;
const FRAMEWORK = /^@nestjs\//;
/** Excepción declarada: el contrato de error conoce las excepciones HTTP porque ÉL es la traducción. */
const FRAMEWORK_ALLOWED = new Set(['src/platform/contracts/application-error.ts']);
/**
 * Deuda CONGELADA (sólo puede encoger): fugas que existen hoy, con la tarea que las retira. Una fuga
 * nueva no entra aquí; se corrige. Si una de estas desaparece, hay que borrarla de la lista.
 */
const LEAK_BASELINE: Readonly<Record<string, string>> = {
  // Los tipos de la sesión se derivan del repositorio (y por tanto de los modelos). AT-025 los sustituye por valores propios.
  'src/modules/credit/application/ports/credit-unit-of-work.port.ts → ../../credit.repository.js': 'AT-025',
  'src/modules/risk/application/ports/risk-assessment-store.port.ts → ../../risk.repository.js': 'AT-025',
  // El consumidor local recibe la transacción del dispatcher (AT-035); el transporte del piloto (AT-056) la retira del puerto.
  'src/platform/events/event-consumer.port.ts → sequelize': 'AT-056',
};

function importsOf(source: string): string[] {
  return [...source.matchAll(/from\s+'([^']+)'/g)].map((match) => match[1]);
}

describe('AT-051 · superficies públicas sin fugas', () => {
  const files = publicSurfaces();

  it('hay superficies públicas que comprobar', () => {
    expect(files.length).toBeGreaterThan(10);
  });

  it('ningún puerto ni contrato público importa el ORM, modelos, repositorios o infraestructura', () => {
    const leaks: string[] = [];
    for (const file of files) {
      for (const specifier of importsOf(readFileSync(file, 'utf8'))) {
        if (LEAK.test(specifier)) leaks.push(`${relative(ROOT, file)} → ${specifier}`);
      }
    }
    const fresh = leaks.filter((leak) => !(leak in LEAK_BASELINE));
    expect(fresh).toEqual([]);
    // La línea base sólo encoge: una entrada que ya no existe se retira de la lista.
    expect(Object.keys(LEAK_BASELINE).filter((leak) => !leaks.includes(leak))).toEqual([]);
  });

  it('el framework sólo aparece en las excepciones declaradas', () => {
    const offenders: string[] = [];
    for (const file of files) {
      const rel = relative(ROOT, file);
      if (FRAMEWORK_ALLOWED.has(rel)) continue;
      for (const specifier of importsOf(readFileSync(file, 'utf8'))) {
        if (FRAMEWORK.test(specifier)) offenders.push(`${rel} → ${specifier}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('ninguna superficie pública exporta o nombra `Transaction` de Sequelize (salvo la deuda congelada)', () => {
    const frozen = new Set(Object.keys(LEAK_BASELINE).map((leak) => leak.split(' → ')[0]));
    const offenders = files
      .map((file) => relative(ROOT, file))
      .filter((rel) => !frozen.has(rel))
      .filter((rel) => /\bTransaction\b/.test(readFileSync(join(ROOT, rel), 'utf8')));
    expect(offenders).toEqual([]);
  });

  it('cada directorio con umbral de cobertura propio existe y contiene fuentes (mover auth/risk/fraud no apaga el umbral)', () => {
    const config = readFileSync(join(ROOT, 'jest.config.cjs'), 'utf8');
    const thresholds = [...config.matchAll(/'(\.\/src\/[^']+)':\s*\{/g)].map((match) => match[1]);
    expect(thresholds).toEqual(
      expect.arrayContaining(['./src/modules/auth/', './src/modules/risk/', './src/modules/fraud/', './src/common/utils/crypto/']),
    );
    for (const dir of thresholds) {
      const entries = readdirSync(join(ROOT, dir), { recursive: true }) as string[];
      expect({ dir, sources: entries.filter((entry) => entry.endsWith('.ts')).length }).toEqual({ dir, sources: expect.any(Number) });
      expect(entries.some((entry) => entry.endsWith('.ts'))).toBe(true);
    }
  });
});
