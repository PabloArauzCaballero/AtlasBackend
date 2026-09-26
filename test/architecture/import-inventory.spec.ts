/**
 * @file Prueba del inventario de imports contra fixtures que reproducen los tres casos del plan:
 *   un ciclo A→B→A, un reexport que llega a infraestructura ajena, y un `.js` que apunta a fuente `.ts`.
 * @business Un inventario que no detecta un ciclo real daría por extraíble un módulo que no lo es.
 * @system Escribe un `src/modules/...` mínimo en un directorio temporal y ejecuta la misma función
 *   que usa el script; no depende del árbol real del repositorio.
 */
import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import ts from 'typescript';
import { contextOf, inventoryImports, stronglyConnectedComponents } from '../../scripts/architecture/inventory-imports.js';

const compilerOptions: ts.CompilerOptions = {
  module: ts.ModuleKind.NodeNext,
  moduleResolution: ts.ModuleResolutionKind.NodeNext,
  target: ts.ScriptTarget.ES2022,
  strict: true,
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
  rootDir = mkdtempSync(join(tmpdir(), 'atlas-import-inventory-'));
  // Ciclo A→B→A con imports .js que apuntan a fuente .ts.
  write(
    'src/modules/a/a.service.ts',
    "import { BService } from '../b/b.service.js';\nexport class AService { constructor(readonly b: BService) {} }\n",
  );
  write('src/modules/b/b.service.ts', "import type { AService } from '../a/a.service.js';\nexport class BService { a?: AService; }\n");
  // C importa por un barrel (reexport) que acaba en el repositorio de D.
  write('src/modules/d/d.repository.ts', 'export class DRepository {}\n');
  write('src/modules/d/index.ts', "export { DRepository } from './d.repository.js';\n");
  write(
    'src/modules/c/c.service.ts',
    "import { DRepository } from '../d/index.js';\nexport class CService { constructor(readonly d: DRepository) {} }\n",
  );
  // E importa un modelo ORM compartido (fuera de los módulos) y una transacción de Sequelize.
  write('src/database/models/thing.model.ts', 'export class ThingModel {}\n');
  write(
    'src/modules/e/e.service.ts',
    "import { ThingModel } from '../../database/models/thing.model.js';\nexport class EService { m = ThingModel; }\n",
  );
  // F usa un import dinámico no literal.
  write('src/modules/f/f.service.ts', 'export async function load(name: string) { return import(name); }\n');
});

afterAll(() => {
  rmSync(rootDir, { recursive: true, force: true });
});

describe('inventoryImports', () => {
  it('devuelve la componente circular A↔B con sus dos aristas y respeta type-only', () => {
    const inventory = inventoryImports({ rootDir, files, compilerOptions });
    expect(inventory.cycles).toEqual([['modules/a', 'modules/b']]);
    const ab = inventory.crossModuleEdges.find((edge) => edge.sourceContext === 'modules/a' && edge.targetContext === 'modules/b');
    const ba = inventory.crossModuleEdges.find((edge) => edge.sourceContext === 'modules/b' && edge.targetContext === 'modules/a');
    expect(ab?.kind).toBe('runtime');
    expect(ba?.kind).toBe('type-only');
  });

  it('resuelve un reexport hasta el archivo de infraestructura ajena y lo informa como filtración', () => {
    const inventory = inventoryImports({ rootDir, files, compilerOptions });
    const edge = inventory.crossModuleEdges.find((candidate) => candidate.sourceContext === 'modules/c');
    expect(edge?.target).toBe('src/modules/d/d.repository.ts');
    expect(edge?.viaReexport).toBe(true);
    expect(inventory.leaks).toContainEqual(expect.objectContaining({ leak: 'repository', symbol: 'DRepository' }));
  });

  it('no clasifica como externo un import .js que corresponde a fuente .ts', () => {
    const inventory = inventoryImports({ rootDir, files, compilerOptions });
    const targets = inventory.edges.map((edge) => edge.target);
    expect(targets).toContain('src/modules/b/b.service.ts');
    expect(targets.every((target) => !target.includes('node_modules'))).toBe(true);
  });

  it('atribuye contexto técnico a database/ y marca el import dinámico no literal para revisión', () => {
    const inventory = inventoryImports({ rootDir, files, compilerOptions });
    const modelEdge = inventory.edges.find((edge) => edge.sourceContext === 'modules/e');
    expect(modelEdge?.targetContext).toBe('database');
    // Un modelo compartido no es una arista módulo→módulo, pero sí se registra como arista.
    expect(inventory.crossModuleEdges.some((edge) => edge.sourceContext === 'modules/e')).toBe(false);
    expect(inventory.unresolvedDynamic).toEqual([{ source: 'src/modules/f/f.service.ts', text: 'import(name)' }]);
  });
});

describe('stronglyConnectedComponents', () => {
  it('ignora nodos sueltos y devuelve componentes ordenadas', () => {
    const graph = new Map<string, Set<string>>([
      ['x', new Set(['y'])],
      ['y', new Set(['z'])],
      ['z', new Set(['x'])],
      ['solo', new Set(['x'])],
    ]);
    expect(stronglyConnectedComponents(graph)).toEqual([['x', 'y', 'z']]);
  });
});

describe('contextOf', () => {
  it('distingue módulos, carpetas técnicas y raíz', () => {
    expect(contextOf('src/modules/credit/application/x.ts')).toBe('modules/credit');
    expect(contextOf('src/common/utils/x.ts')).toBe('common');
    expect(contextOf('src/app.module.ts')).toBe('root');
  });
});
