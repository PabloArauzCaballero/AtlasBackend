/**
 * @file Inventario del grafo real de dependencias de código entre módulos.
 * @business Antes de mover un módulo a otro proceso hay que saber de quién depende de verdad; este
 *   inventario mide esa dependencia sobre el código, no sobre la intención de diseño.
 * @system Resuelve cada `import`/`export ... from`/`import()` literal con el compilador TypeScript
 *   (NodeNext, sufijos `.js`, reexports) y produce aristas archivo→archivo con su contexto propietario,
 *   los imports profundos entre módulos, las componentes fuertemente conexas y las filtraciones de
 *   infraestructura (modelos ORM, repositorios, `Transaction`) que cruzan una frontera de módulo.
 *
 * Uso:
 *   tsx scripts/architecture/inventory-imports.ts                # escribe docs/architecture/microservices/import-baseline.json
 *   tsx scripts/architecture/inventory-imports.ts --stdout       # imprime el JSON
 *
 * Es un INVENTARIO, no un gate: no falla por encontrar ciclos. El gate que rechaza infracciones
 * nuevas es AT-012 y se apoya en este resultado. Un import dinámico no literal se marca como
 * `unresolvedDynamic` para revisión explícita; no se declara ausencia de ciclos a partir de grep.
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, relative, resolve, sep } from 'node:path';
import ts from 'typescript';

export type ImportKind = 'runtime' | 'type-only' | 'dynamic';

export type ImportEdge = {
  /** Ruta relativa a `rootDir`, con `/` como separador. */
  source: string;
  target: string;
  kind: ImportKind;
  /** Contexto del archivo origen (`modules/credit`, `common`, `database`, `config`, `root`). */
  sourceContext: string;
  targetContext: string;
  /** Nombres importados; `*` para namespace y `default` para el default. */
  symbols: string[];
  /** El especificador tal y como está escrito (`../../customers/customers.repository.js`). */
  specifier: string;
  /** Verdadero cuando el especificador apunta a un archivo distinto del resuelto (reexport o alias). */
  viaReexport: boolean;
};

export type CrossModuleLeak = {
  edge: ImportEdge;
  /** Qué se filtró: un modelo ORM, un repositorio, un `Transaction` de Sequelize, o un servicio concreto. */
  leak: 'model' | 'repository' | 'transaction' | 'service';
  symbol: string;
};

export type ImportInventory = {
  rootDir: string;
  files: number;
  edges: ImportEdge[];
  /** Aristas entre módulos distintos de `src/modules` (sin `common`, `database`, `config`). */
  crossModuleEdges: ImportEdge[];
  /** Componentes fuertemente conexas de tamaño > 1 sobre el grafo de módulos. */
  cycles: string[][];
  leaks: CrossModuleLeak[];
  unresolvedDynamic: { source: string; text: string }[];
  /** Imports a paquetes (node_modules / builtins): quién usa qué librería. Lo lee la regla de dominio puro. */
  externalImports: { source: string; specifier: string; kind: ImportKind }[];
  /** Por módulo: a quién importa y quién lo importa (sólo módulos). */
  modules: Record<string, { imports: string[]; importedBy: string[]; crossModuleEdges: number }>;
};

export type InventoryOptions = {
  rootDir: string;
  /** Archivos a analizar; por defecto los de `tsconfig.json` bajo `src/`. */
  files?: string[];
  compilerOptions?: ts.CompilerOptions;
};

const MODULE_PREFIX = 'src/modules/';

/** Contexto propietario de una ruta relativa: `modules/<nombre>` o la carpeta técnica de primer nivel. */
export function contextOf(relPath: string): string {
  if (relPath.startsWith(MODULE_PREFIX)) {
    const name = relPath.slice(MODULE_PREFIX.length).split('/')[0];
    return `modules/${name}`;
  }
  const parts = relPath.split('/');
  if (parts[0] === 'src' && parts.length > 2) return parts[1];
  return 'root';
}

function toPosix(path: string): string {
  return path.split(sep).join('/');
}

function loadProjectFiles(rootDir: string): { files: string[]; options: ts.CompilerOptions } {
  const configPath = resolve(rootDir, 'tsconfig.json');
  const config = ts.readConfigFile(configPath, ts.sys.readFile);
  if (config.error) throw new Error(ts.flattenDiagnosticMessageText(config.error.messageText, '\n'));
  const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, rootDir);
  const files = parsed.fileNames.filter((file) => toPosix(relative(rootDir, file)).startsWith('src/'));
  return { files, options: parsed.options };
}

function importedSymbols(node: ts.ImportDeclaration | ts.ExportDeclaration): string[] {
  if (ts.isImportDeclaration(node)) {
    const clause = node.importClause;
    if (!clause) return [];
    const names: string[] = [];
    if (clause.name) names.push('default');
    if (clause.namedBindings) {
      if (ts.isNamespaceImport(clause.namedBindings)) names.push('*');
      else for (const element of clause.namedBindings.elements) names.push(element.propertyName?.text ?? element.name.text);
    }
    return names;
  }
  if (!node.exportClause) return ['*'];
  if (ts.isNamespaceExport(node.exportClause)) return ['*'];
  return node.exportClause.elements.map((element) => element.propertyName?.text ?? element.name.text);
}

function isTypeOnly(node: ts.ImportDeclaration | ts.ExportDeclaration): boolean {
  if (ts.isImportDeclaration(node)) {
    const clause = node.importClause;
    if (!clause) return false;
    if (clause.isTypeOnly) return true;
    if (clause.namedBindings && ts.isNamedImports(clause.namedBindings)) {
      return clause.namedBindings.elements.length > 0 && clause.namedBindings.elements.every((element) => element.isTypeOnly);
    }
    return false;
  }
  return node.isTypeOnly;
}

function classifyLeak(symbol: string, targetRel: string): CrossModuleLeak['leak'] | null {
  if (symbol === 'Transaction') return 'transaction';
  if (/Model$/.test(symbol) || targetRel.includes('/database/models/')) return 'model';
  if (/Repository$/.test(symbol) || /\.repository\.(ts|js)$/.test(targetRel)) return 'repository';
  if (/Service$/.test(symbol)) return 'service';
  return null;
}

/** Sigue `export { X } from './y.js'` / `export * from` hasta el archivo que define el símbolo. */
function followReexports(file: string, symbol: string, program: ts.Program, options: ts.CompilerOptions, depth = 0): string {
  if (depth > 10) return file;
  const source = program.getSourceFile(file);
  if (!source) return file;
  for (const statement of source.statements) {
    if (!ts.isExportDeclaration(statement) || !statement.moduleSpecifier || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
    const names = importedSymbols(statement);
    const matches = names.includes('*') || names.includes(symbol);
    if (!matches) continue;
    const resolved = ts.resolveModuleName(statement.moduleSpecifier.text, file, options, ts.sys).resolvedModule;
    if (!resolved || resolved.isExternalLibraryImport) continue;
    return followReexports(resolved.resolvedFileName, symbol, program, options, depth + 1);
  }
  return file;
}

/** Tarjan sobre el grafo de módulos; devuelve sólo las componentes con más de un nodo. */
export function stronglyConnectedComponents(graph: Map<string, Set<string>>): string[][] {
  let index = 0;
  const stack: string[] = [];
  const onStack = new Set<string>();
  const indices = new Map<string, number>();
  const low = new Map<string, number>();
  const result: string[][] = [];

  const visit = (node: string): void => {
    indices.set(node, index);
    low.set(node, index);
    index += 1;
    stack.push(node);
    onStack.add(node);
    for (const next of graph.get(node) ?? []) {
      if (!indices.has(next)) {
        visit(next);
        low.set(node, Math.min(low.get(node) ?? 0, low.get(next) ?? 0));
      } else if (onStack.has(next)) {
        low.set(node, Math.min(low.get(node) ?? 0, indices.get(next) ?? 0));
      }
    }
    if (low.get(node) === indices.get(node)) {
      const component: string[] = [];
      let current: string | undefined;
      do {
        current = stack.pop();
        if (current === undefined) break;
        onStack.delete(current);
        component.push(current);
      } while (current !== node);
      if (component.length > 1) result.push(component.sort());
    }
  };

  for (const node of [...graph.keys()].sort()) if (!indices.has(node)) visit(node);
  return result.sort((a, b) => a[0].localeCompare(b[0]));
}

export function inventoryImports(input: InventoryOptions): ImportInventory {
  const rootDir = resolve(input.rootDir);
  const project = input.files ? null : loadProjectFiles(rootDir);
  const files = input.files ?? project?.files ?? [];
  const options: ts.CompilerOptions = input.compilerOptions ??
    project?.options ?? { module: ts.ModuleKind.NodeNext, moduleResolution: ts.ModuleResolutionKind.NodeNext };
  const program = ts.createProgram(files, options);

  const edges: ImportEdge[] = [];
  const unresolvedDynamic: ImportInventory['unresolvedDynamic'] = [];
  const externalImports: ImportInventory['externalImports'] = [];

  const record = (sourceFile: ts.SourceFile, specifier: string, kind: ImportKind, symbols: string[]): void => {
    const resolved = ts.resolveModuleName(specifier, sourceFile.fileName, options, ts.sys).resolvedModule;
    if (!resolved || resolved.isExternalLibraryImport) {
      if (!specifier.startsWith('.')) externalImports.push({ source: toPosix(relative(rootDir, sourceFile.fileName)), specifier, kind });
      return;
    }
    if (!resolved.resolvedFileName.startsWith(rootDir)) return;
    const sourceRel = toPosix(relative(rootDir, sourceFile.fileName));
    let targetFile = resolved.resolvedFileName;
    let viaReexport = false;
    if (symbols.length === 1 && symbols[0] !== '*' && symbols[0] !== 'default') {
      const followed = followReexports(targetFile, symbols[0], program, options);
      viaReexport = followed !== targetFile;
      targetFile = followed;
    }
    const targetRel = toPosix(relative(rootDir, targetFile));
    edges.push({
      source: sourceRel,
      target: targetRel,
      kind,
      sourceContext: contextOf(sourceRel),
      targetContext: contextOf(targetRel),
      symbols,
      specifier,
      viaReexport,
    });
  };

  for (const file of files) {
    const sourceFile = program.getSourceFile(file);
    if (!sourceFile) continue;
    const walk = (node: ts.Node): void => {
      if (
        (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
        node.moduleSpecifier &&
        ts.isStringLiteral(node.moduleSpecifier)
      ) {
        record(sourceFile, node.moduleSpecifier.text, isTypeOnly(node) ? 'type-only' : 'runtime', importedSymbols(node));
      } else if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
        const argument = node.arguments[0];
        if (argument && ts.isStringLiteral(argument)) record(sourceFile, argument.text, 'dynamic', ['*']);
        else unresolvedDynamic.push({ source: toPosix(relative(rootDir, file)), text: node.getText(sourceFile) });
      }
      ts.forEachChild(node, walk);
    };
    walk(sourceFile);
  }

  const isModule = (context: string): boolean => context.startsWith('modules/');
  const crossModuleEdges = edges.filter(
    (edge) => isModule(edge.sourceContext) && isModule(edge.targetContext) && edge.sourceContext !== edge.targetContext,
  );

  const graph = new Map<string, Set<string>>();
  const modules: ImportInventory['modules'] = {};
  const ensure = (name: string): void => {
    if (!graph.has(name)) graph.set(name, new Set());
    if (!modules[name]) modules[name] = { imports: [], importedBy: [], crossModuleEdges: 0 };
  };
  for (const edge of edges) if (isModule(edge.sourceContext)) ensure(edge.sourceContext);
  for (const edge of crossModuleEdges) {
    ensure(edge.sourceContext);
    ensure(edge.targetContext);
    graph.get(edge.sourceContext)?.add(edge.targetContext);
    modules[edge.sourceContext].crossModuleEdges += 1;
  }
  for (const [name, targets] of graph) {
    modules[name].imports = [...targets].sort();
    for (const target of targets) modules[target].importedBy.push(name);
  }
  for (const entry of Object.values(modules)) entry.importedBy.sort();

  const leaks: CrossModuleLeak[] = [];
  for (const edge of crossModuleEdges) {
    for (const symbol of edge.symbols) {
      const leak = classifyLeak(symbol, edge.target);
      if (leak) leaks.push({ edge, leak, symbol });
    }
  }

  return {
    rootDir,
    files: files.length,
    edges,
    crossModuleEdges,
    cycles: stronglyConnectedComponents(graph),
    leaks,
    unresolvedDynamic,
    externalImports,
    modules: Object.fromEntries(Object.entries(modules).sort(([a], [b]) => a.localeCompare(b))),
  };
}

/** Resumen serializable para el baseline: sin repetir cada arista archivo→archivo (queda en `edges`). */
export function summarize(inventory: ImportInventory): Record<string, unknown> {
  const leaksByKind: Record<string, number> = {};
  for (const leak of inventory.leaks) leaksByKind[leak.leak] = (leaksByKind[leak.leak] ?? 0) + 1;
  return {
    files: inventory.files,
    edges: inventory.edges.length,
    crossModuleEdges: inventory.crossModuleEdges.length,
    modules: Object.keys(inventory.modules).length,
    cycles: inventory.cycles,
    leaksByKind,
    unresolvedDynamic: inventory.unresolvedDynamic.length,
  };
}

function main(): void {
  const rootDir = process.cwd();
  const inventory = inventoryImports({ rootDir });
  const output = {
    generatedAt: new Date().toISOString(),
    summary: summarize(inventory),
    modules: inventory.modules,
    cycles: inventory.cycles,
    leaks: inventory.leaks.map((leak) => ({
      leak: leak.leak,
      symbol: leak.symbol,
      source: leak.edge.source,
      target: leak.edge.target,
      kind: leak.edge.kind,
    })),
    unresolvedDynamic: inventory.unresolvedDynamic,
    crossModuleEdges: inventory.crossModuleEdges.map((edge) => ({
      source: edge.source,
      target: edge.target,
      kind: edge.kind,
      symbols: edge.symbols,
      viaReexport: edge.viaReexport,
    })),
  };
  const json = `${JSON.stringify(output, null, 2)}\n`;
  if (process.argv.includes('--stdout')) {
    process.stdout.write(json);
    return;
  }
  const target = resolve(rootDir, 'docs/architecture/microservices/import-baseline.json');
  if (!existsSync(dirname(target))) mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, json);
  const summary = output.summary as { crossModuleEdges: number; cycles: string[][]; leaksByKind: Record<string, number> };
  console.log(
    `Inventario escrito en ${relative(rootDir, target)}: ${summary.crossModuleEdges} aristas entre módulos, ` +
      `${summary.cycles.length} ciclo(s), filtraciones ${JSON.stringify(summary.leaksByKind)}.`,
  );
}

// Sin `import.meta`: las pruebas se transforman a CommonJS (jest.config.cjs) y lo rechazarían.
const invokedDirectly = /inventory-imports\.(ts|js)$/.test(process.argv[1] ?? '');
if (invokedDirectly) main();
