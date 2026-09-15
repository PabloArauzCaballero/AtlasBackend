/**
 * @file Gate de fronteras entre módulos (AT-012): `yarn check:architecture`.
 * @business Una dependencia nueva que cruza un contexto sin permiso rompe el build con origen y destino
 *   exactos; la deuda heredada está congelada y sólo puede bajar.
 * @system Inventaría los imports con el compilador (`inventory-imports.ts`), los evalúa contra
 *   `config/architecture/boundaries.json` (`boundaries.ts`) y compara con la línea base
 *   `boundaries-baseline.json`. Termina con código 1 si hay infracciones fuera de la línea base o si
 *   el manifiesto es inválido. `--update-baseline` reescribe la línea base sólo si ENCOGE;
 *   `--update-baseline --allow-growth` la deja crecer y hay que justificarlo en la revisión.
 */
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { compareWithBaseline, evaluateBoundaries, validateManifest, type BoundaryManifest } from './boundaries.js';
import { inventoryImports } from './inventory-imports.js';

export function loadManifest(rootDir: string): BoundaryManifest {
  return JSON.parse(readFileSync(resolve(rootDir, 'config/architecture/boundaries.json'), 'utf8')) as BoundaryManifest;
}

export function loadBaseline(rootDir: string, manifest: BoundaryManifest): string[] {
  const path = resolve(rootDir, manifest.legacyBaseline);
  if (!existsSync(path)) return [];
  return (JSON.parse(readFileSync(path, 'utf8')) as { violations: string[] }).violations;
}

function main(): void {
  const rootDir = process.cwd();
  const manifest = loadManifest(rootDir);
  const moduleDirs = readdirSync(resolve(rootDir, 'src/modules'), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);
  const manifestErrors = validateManifest(manifest, moduleDirs);
  if (manifestErrors.length > 0) {
    console.error(`❌ Manifiesto de fronteras inválido:\n   - ${manifestErrors.join('\n   - ')}`);
    process.exit(1);
  }

  const inventory = inventoryImports({ rootDir });
  const violations = evaluateBoundaries(inventory, manifest);
  const baseline = loadBaseline(rootDir, manifest);
  const comparison = compareWithBaseline(violations, baseline);
  const byRule = violations.reduce<Record<string, number>>(
    (acc, violation) => ({ ...acc, [violation.rule]: (acc[violation.rule] ?? 0) + 1 }),
    {},
  );

  if (process.argv.includes('--update-baseline')) {
    if (comparison.newViolations.length > 0 && !process.argv.includes('--allow-growth')) {
      console.error(
        `❌ La línea base sólo puede encoger: hay ${comparison.newViolations.length} infracción(es) nueva(s). Corrígelas o pasa --allow-growth y justifícalo.`,
      );
      process.exit(1);
    }
    const path = resolve(rootDir, manifest.legacyBaseline);
    writeFileSync(
      path,
      `${JSON.stringify({ $comment: 'Deuda heredada de fronteras (AT-012). Generada por yarn check:architecture --update-baseline; sólo puede encoger.', updatedOn: new Date().toISOString().slice(0, 10), count: violations.length, byRule, violations: violations.map((violation) => violation.key) }, null, 2)}\n`,
    );
    console.log(`Línea base escrita: ${violations.length} infracción(es) congelada(s) ${JSON.stringify(byRule)}.`);
    return;
  }

  console.log(
    `Fronteras: ${violations.length} infracción(es) ${JSON.stringify(byRule)}; línea base ${baseline.length}; resueltas ${comparison.resolved.length}; nuevas ${comparison.newViolations.length}.`,
  );
  if (comparison.resolved.length > 0) {
    console.log(
      `ℹ️  ${comparison.resolved.length} entrada(s) de la línea base ya no infringen. Corre "yarn check:architecture --update-baseline" para fijar el nuevo piso.`,
    );
  }
  if (comparison.newViolations.length > 0) {
    console.error(`❌ Infracciones NUEVAS de fronteras (no están en ${manifest.legacyBaseline}):`);
    for (const violation of comparison.newViolations)
      console.error(`   - [${violation.rule}] ${violation.source} → ${violation.target}: ${violation.detail}`);
    process.exit(1);
  }
}

const invokedDirectly = /check-boundaries\.(ts|js)$/.test(process.argv[1] ?? '');
if (invokedDirectly) main();
