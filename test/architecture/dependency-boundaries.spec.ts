/**
 * @file Prueba negativa del gate de fronteras (AT-012): detecta lo que debe y deja pasar lo permitido.
 * @business Un gate que siempre termina en cero no es un control; aquí se demuestra que rechaza una
 *   infracción real con origen y destino exactos.
 * @system Fixtures en un directorio temporal con un manifiesto mínimo: import a repositorio ajeno,
 *   ciclo por `index.ts`, dominio que importa Sequelize, composition root que importa implementación
 *   (permitido), y comparación con línea base (no crecimiento).
 */
import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import ts from 'typescript';
import { compareWithBaseline, evaluateBoundaries, type BoundaryManifest } from '../../scripts/architecture/boundaries.js';
import { inventoryImports } from '../../scripts/architecture/inventory-imports.js';

const compilerOptions: ts.CompilerOptions = {
  module: ts.ModuleKind.NodeNext,
  moduleResolution: ts.ModuleResolutionKind.NodeNext,
  target: ts.ScriptTarget.ES2022,
};

const manifest: BoundaryManifest = {
  version: 1,
  shared: ['common', 'database'],
  compositionRoots: ['src/app.module.ts', '**/*.module.ts'],
  legacyBaseline: 'baseline.json',
  contexts: { a: { title: 'A' }, b: { title: 'B' }, c: { title: 'C' } },
  modules: {
    alpha: { context: 'a', allowedDependencies: ['beta'] },
    beta: { context: 'b', allowedDependencies: [] },
    gamma: { context: 'c', allowedDependencies: [] },
    delta: { context: 'c', allowedDependencies: [] },
  },
  exceptions: [],
};

let rootDir: string;
const files: string[] = [];
function write(relPath: string, content: string): void {
  const absolute = join(rootDir, relPath);
  mkdirSync(join(absolute, '..'), { recursive: true });
  writeFileSync(absolute, content);
  files.push(absolute);
}

beforeAll(() => {
  rootDir = mkdtempSync(join(tmpdir(), 'atlas-boundaries-'));
  write('src/modules/beta/beta.repository.ts', 'export class BetaRepository {}\n');
  write('src/modules/beta/index.ts', "export { BetaRepository } from './beta.repository.js';\n");
  // alpha→beta permitido; gamma→beta NO (contextos distintos, sin permiso).
  write(
    'src/modules/alpha/alpha.service.ts',
    "import { BetaRepository } from '../beta/beta.repository.js';\nexport class AlphaService { constructor(readonly r: BetaRepository) {} }\n",
  );
  write(
    'src/modules/gamma/gamma.service.ts',
    "import { BetaRepository } from '../beta/index.js';\nexport class GammaService { constructor(readonly r: BetaRepository) {} }\n",
  );
  // gamma↔delta: mismo contexto (permitido) pero forman ciclo a través de index.ts.
  write('src/modules/delta/index.ts', "export { DeltaService } from './delta.service.js';\n");
  write(
    'src/modules/delta/delta.service.ts',
    "import { GammaService } from '../gamma/gamma.service.js';\nexport class DeltaService { g?: GammaService; }\n",
  );
  write('src/modules/gamma/gamma-uses-delta.ts', "import { DeltaService } from '../delta/index.js';\nexport const d = DeltaService;\n");
  // Dominio impuro.
  write('src/modules/alpha/domain/policy.ts', "import { Transaction } from 'sequelize';\nexport type T = Transaction;\n");
  // Composition root: importa implementación ajena y está permitido.
  write(
    'src/modules/gamma/gamma.module.ts',
    "import { BetaRepository } from '../beta/beta.repository.js';\nexport const providers = [BetaRepository];\n",
  );
  write(
    'src/app.module.ts',
    "import { BetaRepository } from './modules/beta/beta.repository.js';\nexport const root = [BetaRepository];\n",
  );
});

afterAll(() => {
  rmSync(rootDir, { recursive: true, force: true });
});

describe('gate de fronteras (AT-012)', () => {
  const run = () => evaluateBoundaries(inventoryImports({ rootDir, files, compilerOptions }), manifest, '2026-09-11');

  it('un import nuevo a un repositorio ajeno se rechaza con origen y destino exactos', () => {
    const violation = run().find(
      (candidate) => candidate.rule === 'cross-module' && candidate.source === 'src/modules/gamma/gamma.service.ts',
    );
    expect(violation).toMatchObject({
      target: 'src/modules/beta/beta.repository.ts',
      key: 'import:src/modules/gamma/gamma.service.ts->src/modules/beta/beta.repository.ts',
    });
    expect(violation?.detail).toContain('gamma no tiene permitido depender de beta');
  });

  it('una dependencia permitida por el manifiesto no aparece como infracción', () => {
    expect(run().some((violation) => violation.source === 'src/modules/alpha/alpha.service.ts')).toBe(false);
  });

  it('un ciclo introducido mediante index.ts se detecta aunque no haya forwardRef', () => {
    const cycle = run().find((violation) => violation.rule === 'cycle');
    expect(cycle?.key).toBe('cycle:delta<->gamma');
  });

  it('el dominio que importa Sequelize se rechaza', () => {
    const violation = run().find((candidate) => candidate.rule === 'domain-purity');
    expect(violation).toMatchObject({ source: 'src/modules/alpha/domain/policy.ts', target: 'sequelize' });
  });

  it('una factory en el composition root (módulo Nest o raíz) se permite sin exigir inversión artificial', () => {
    const violations = run();
    expect(violations.some((violation) => violation.source === 'src/modules/gamma/gamma.module.ts')).toBe(false);
    expect(violations.some((violation) => violation.source === 'src/app.module.ts')).toBe(false);
  });

  it('una excepción vigente cubre la dependencia; una vencida no', () => {
    const withException: BoundaryManifest = {
      ...manifest,
      exceptions: [
        {
          id: 'g-b',
          kind: 'legacy-dependency',
          from: 'gamma',
          to: ['beta'],
          owner: 'x',
          task: 'AT-020',
          expires: '2027-01-01',
          reason: 'x',
        },
      ],
    };
    const inventory = inventoryImports({ rootDir, files, compilerOptions });
    expect(evaluateBoundaries(inventory, withException, '2026-09-11').some((v) => v.source === 'src/modules/gamma/gamma.service.ts')).toBe(
      false,
    );
    expect(evaluateBoundaries(inventory, withException, '2027-06-01').some((v) => v.source === 'src/modules/gamma/gamma.service.ts')).toBe(
      true,
    );
  });

  it('la línea base distingue infracciones nuevas de las congeladas y de las resueltas', () => {
    const violations = run();
    const baseline = [violations[0].key, 'import:ya/no/existe->x'];
    const comparison = compareWithBaseline(violations, baseline);
    expect(comparison.unchanged).toBe(1);
    expect(comparison.resolved).toEqual(['import:ya/no/existe->x']);
    expect(comparison.newViolations.length).toBe(violations.length - 1);
  });
});
