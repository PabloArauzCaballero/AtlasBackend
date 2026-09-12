/**
 * @file Manifiesto de fronteras entre módulos y su evaluación (AT-011, AT-012).
 * @business Un módulo sólo puede depender de lo que el manifiesto le permite; lo que hoy se salta esa
 *   regla está congelado en una línea base que no puede crecer. Así la deuda se ve, se asigna y baja.
 * @system Funciones puras sobre el inventario de imports (`inventory-imports.ts`) y el manifiesto
 *   `config/architecture/boundaries.json`. Cuatro reglas: dependencia entre módulos permitida por
 *   contexto/lista/excepción; dominio puro (sin Nest/Sequelize/HTTP/env); contratos públicos sin
 *   modelos ni `Transaction`; sin ciclos entre módulos salvo excepción con dueño, tarea y vencimiento.
 */
import type { ImportInventory } from './inventory-imports.js';

export type BoundaryException = {
  id: string;
  kind: 'transactional-bridge' | 'cycle' | 'legacy-dependency';
  from: string;
  to: string[];
  owner: string;
  task: string;
  expires: string;
  reason: string;
};

export type BoundaryManifest = {
  version: number;
  /** Carpetas técnicas bajo `src/` que cualquier módulo puede importar. */
  shared: string[];
  /** Archivos/patrones que componen (raíces, `*.module.ts`): se les permite importar implementación. */
  compositionRoots: string[];
  contexts: Record<string, { title: string }>;
  modules: Record<string, { context: string; publicEntry?: string; allowedDependencies: string[] }>;
  exceptions: BoundaryException[];
  legacyBaseline: string;
};

export type BoundaryViolation = {
  rule: 'cross-module' | 'domain-purity' | 'public-contract' | 'cycle';
  key: string;
  source: string;
  target: string;
  detail: string;
};

const FORBIDDEN_IN_DOMAIN = /^(@nestjs\/|sequelize|sequelize-typescript|express|ioredis|mongodb|axios|node:http|pg$)/;

export function validateManifest(manifest: BoundaryManifest, moduleDirs: string[]): string[] {
  const errors: string[] = [];
  const known = new Set(Object.keys(manifest.modules));
  for (const dir of moduleDirs) if (!known.has(dir)) errors.push(`carpeta_sin_contexto:${dir}`);
  for (const name of known) if (!moduleDirs.includes(name)) errors.push(`modulo_sin_carpeta:${name}`);
  for (const [name, entry] of Object.entries(manifest.modules)) {
    if (!manifest.contexts[entry.context]) errors.push(`contexto_desconocido:${name}→${entry.context}`);
    for (const dependency of entry.allowedDependencies) {
      if (dependency === '*' || dependency.includes('*')) errors.push(`comodin_prohibido:${name}→${dependency}`);
      else if (!known.has(dependency)) errors.push(`dependencia_desconocida:${name}→${dependency}`);
    }
  }
  const ids = new Set<string>();
  for (const exception of manifest.exceptions) {
    if (!exception.id || ids.has(exception.id)) errors.push(`excepcion_sin_id_unico:${exception.id ?? '?'}`);
    ids.add(exception.id);
    if (!exception.owner) errors.push(`excepcion_sin_responsable:${exception.id}`);
    if (!/^AT-\d{3}$/.test(exception.task ?? '')) errors.push(`excepcion_sin_tarea_de_retirada:${exception.id}`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(exception.expires ?? '')) errors.push(`excepcion_sin_vencimiento:${exception.id}`);
    if (!known.has(exception.from)) errors.push(`excepcion_origen_desconocido:${exception.id}`);
    for (const to of exception.to ?? []) if (!known.has(to)) errors.push(`excepcion_destino_desconocido:${exception.id}→${to}`);
    if (exception.to?.some((to) => to === '*')) errors.push(`comodin_prohibido:${exception.id}`);
  }
  return errors;
}

function moduleOf(context: string): string | null {
  return context.startsWith('modules/') ? context.slice('modules/'.length) : null;
}

function isCompositionRoot(file: string, manifest: BoundaryManifest): boolean {
  return manifest.compositionRoots.some((pattern) => {
    if (pattern.endsWith('/**')) return file.startsWith(pattern.slice(0, -3));
    if (pattern.startsWith('**/*')) return file.endsWith(pattern.slice(4));
    if (pattern.startsWith('**/')) return file.endsWith(`/${pattern.slice(3)}`);
    return file === pattern;
  });
}

function exceptionCovers(manifest: BoundaryManifest, from: string, to: string, kinds: BoundaryException['kind'][], today: string): boolean {
  return manifest.exceptions.some(
    (exception) => kinds.includes(exception.kind) && exception.from === from && exception.to.includes(to) && exception.expires >= today,
  );
}

export function evaluateBoundaries(
  inventory: ImportInventory,
  manifest: BoundaryManifest,
  today = new Date().toISOString().slice(0, 10),
): BoundaryViolation[] {
  const violations: BoundaryViolation[] = [];
  const contextOfModule = (name: string): string | undefined => manifest.modules[name]?.context;

  for (const edge of inventory.edges) {
    const from = moduleOf(edge.sourceContext);
    const to = moduleOf(edge.targetContext);
    // Regla 2: dominio puro. Se mira el especificador escrito, no sólo el archivo resuelto.
    if (from && /^src\/modules\/[^/]+\/domain\//.test(edge.source)) {
      if (edge.targetContext !== edge.sourceContext) {
        violations.push({
          rule: 'domain-purity',
          key: `domain:${edge.source}->${edge.target}`,
          source: edge.source,
          target: edge.target,
          detail: 'el dominio sólo importa su propio módulo (valores puros); ni infraestructura compartida ni otros módulos',
        });
      }
    }
    // Regla 3: un contrato público no exporta modelos ni transacciones.
    if (from && /^src\/modules\/[^/]+\/public\//.test(edge.source)) {
      const leaked = edge.symbols.filter((symbol) => /Model$/.test(symbol) || symbol === 'Transaction' || /Repository$/.test(symbol));
      if (leaked.length > 0 || edge.target.includes('/database/models/')) {
        violations.push({
          rule: 'public-contract',
          key: `public:${edge.source}->${edge.target}`,
          source: edge.source,
          target: edge.target,
          detail: `el contrato público expone ${leaked.join(', ') || 'un modelo ORM'}`,
        });
      }
    }
    // Regla 1: dependencia entre módulos.
    if (!from || !to || from === to) continue;
    if (isCompositionRoot(edge.source, manifest)) continue;
    const allowed =
      contextOfModule(from) !== undefined && contextOfModule(from) === contextOfModule(to)
        ? true
        : (manifest.modules[from]?.allowedDependencies ?? []).includes(to) ||
          exceptionCovers(manifest, from, to, ['transactional-bridge', 'legacy-dependency'], today);
    if (!allowed) {
      violations.push({
        rule: 'cross-module',
        key: `import:${edge.source}->${edge.target}`,
        source: edge.source,
        target: edge.target,
        detail: `${from} no tiene permitido depender de ${to} (símbolos: ${edge.symbols.join(', ')})`,
      });
    }
  }

  // Regla 2 bis: `process.env` y clientes externos en dominio se detectan por especificador externo.
  for (const edge of inventory.externalImports ?? []) {
    if (/^src\/modules\/[^/]+\/domain\//.test(edge.source) && FORBIDDEN_IN_DOMAIN.test(edge.specifier)) {
      violations.push({
        rule: 'domain-purity',
        key: `domain-external:${edge.source}->${edge.specifier}`,
        source: edge.source,
        target: edge.specifier,
        detail: 'el dominio no importa Nest, Sequelize, HTTP ni clientes externos',
      });
    }
  }

  // Regla 4: ciclos.
  for (const component of inventory.cycles) {
    const members = component.map((name) => moduleOf(name) ?? name).sort();
    // Una excepción de ciclo cubre EXACTAMENTE esa componente: {from, ...to} == miembros. Así un ciclo
    // que crece (un módulo más) deja de estar cubierto y se ve.
    const covered = manifest.exceptions.some(
      (exception) =>
        exception.kind === 'cycle' &&
        exception.expires >= today &&
        [exception.from, ...exception.to].sort().join(',') === members.join(','),
    );
    if (!covered) {
      violations.push({
        rule: 'cycle',
        key: `cycle:${members.join('<->')}`,
        source: members[0],
        target: members.slice(1).join(','),
        detail: `componente fuertemente conexa sin excepción vigente: ${members.join(' ↔ ')}`,
      });
    }
  }

  return violations.sort((a, b) => a.key.localeCompare(b.key));
}

export type BaselineComparison = { newViolations: BoundaryViolation[]; resolved: string[]; unchanged: number };

export function compareWithBaseline(violations: BoundaryViolation[], baseline: string[]): BaselineComparison {
  const known = new Set(baseline);
  const current = new Set(violations.map((violation) => violation.key));
  return {
    newViolations: violations.filter((violation) => !known.has(violation.key)),
    resolved: baseline.filter((key) => !current.has(key)),
    unchanged: violations.filter((violation) => known.has(violation.key)).length,
  };
}
