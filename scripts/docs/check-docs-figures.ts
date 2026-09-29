/**
 * @file Gate: las cifras y los comandos `yarn` que cita la documentación existen y son verdad.
 * @business Una cifra o un comando en la documentación o es verdad y está vigilado, o no debería estar.
 * @system `yarn check:docs-figures` comprueba; `yarn docs:figures` reescribe las cifras y bloques marcados.
 *
 * Dos comprobaciones:
 *
 *  1. **Cifras.** Una cifra citable va entre marcas: `<!-- fig:openapi.paths -->534<!-- /fig -->`, y una
 *     tabla generada entre `<!-- gen:jobs-always -->` y `<!-- /gen:jobs-always -->`. El gate recalcula
 *     cada valor desde el código (`lib/code-figures.ts`) y falla si difiere, si la clave no existe o si
 *     a uno de los documentos vigilados le falta una marca obligatoria (borrar la marca y dejar el número
 *     a mano es justo como envejecieron: «252 rutas», «27 módulos», «7 jobs», «89 eventos»).
 *  2. **Comandos.** Todo `yarn <comando>` citado como código (span o bloque cercado) en un `.md` debe ser
 *     un script de `package.json`, un comando propio de yarn o un binario de `node_modules/.bin`;
 *     `yarn prefijo:*` vale si algún script empieza así. Fuera de alcance, por ser registros FECHADOS que
 *     no se reescriben (reescribirlos falsearía la evidencia de su día): `docs/audit/**`, `evidencia/**`
 *     y `CHANGELOG.md`; y `.claude/**`, plantillas de habilidades compartidas entre repositorios.
 */
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { computeFigures, generatedBlocks } from './lib/code-figures.js';
import { describeDrift, isKnownCommand, rewriteMarkers, yarnCommands } from './lib/doc-markers.js';
import { codeSnippets, trackedMarkdown } from './lib/markdown.js';

/** Marcas que cada documento vigilado DEBE contener. */
const REQUIRED_MARKERS: Readonly<Record<string, readonly string[]>> = {
  'docs/index.md': ['fig:openapi.paths', 'fig:openapi.operations', 'fig:code.modules'],
  'docs/architecture/index.md': [
    'fig:code.modules',
    'fig:code.controllers',
    'fig:code.controllerFiles',
    'fig:code.ormModels',
    'fig:code.migrations',
    'fig:db.tables',
    'fig:db.schemas',
    'fig:code.routes',
    'fig:openapi.paths',
    'fig:openapi.operations',
    'fig:arch.moduleEdges',
    'fig:arch.cycles',
  ],
  'docs/architecture/background-processing.md': [
    'fig:jobs.always',
    'fig:jobs.optional',
    'fig:jobs.intervalSources',
    'gen:jobs-always',
    'gen:jobs-optional',
    'gen:interval-sources',
  ],
  'docs/events/overview.md': ['fig:events.codes', 'fig:events.families', 'fig:events.emitted', 'fig:events.reserved'],
};

const COMMAND_SCOPE_EXCLUDE = ['docs/audit/', 'evidencia/', 'CHANGELOG.md', '.claude/'];

type Problem = { file: string; message: string };

async function checkFigures(write: boolean): Promise<Problem[]> {
  const figures = await computeFigures();
  const blocks = generatedBlocks();
  const problems: Problem[] = [];
  const files = new Set([...trackedMarkdown({ include: ['docs/', 'README.md'] }), ...Object.keys(REQUIRED_MARKERS)]);
  for (const file of files) {
    let current: string;
    try {
      current = readFileSync(file, 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      problems.push({ file, message: 'documento vigilado ausente' });
      continue;
    }
    for (const marker of REQUIRED_MARKERS[file] ?? []) {
      if (!current.includes(`<!-- ${marker} -->`)) problems.push({ file, message: `falta la marca obligatoria <!-- ${marker} -->` });
    }
    const { text, unknown } = rewriteMarkers(current, figures, blocks);
    unknown.forEach((key) =>
      problems.push({ file, message: `marca desconocida ${key} (claves válidas en scripts/docs/lib/code-figures.ts)` }),
    );
    if (text === current) continue;
    if (write) {
      writeFileSync(file, text, 'utf8');
      console.log(`✏️  ${file}: cifras actualizadas`);
    } else {
      describeDrift(current, text).forEach((message) => problems.push({ file, message }));
    }
  }
  return problems;
}

function knownCommands(): { scripts: Set<string>; binaries: Set<string> } {
  const pkg = JSON.parse(readFileSync('package.json', 'utf8')) as { scripts?: Record<string, string> };
  const binDir = resolve('node_modules/.bin');
  return { scripts: new Set(Object.keys(pkg.scripts ?? {})), binaries: new Set(existsSync(binDir) ? readdirSync(binDir) : []) };
}

function checkCommands(): Problem[] {
  const known = knownCommands();
  const problems: Problem[] = [];
  for (const file of trackedMarkdown({ exclude: COMMAND_SCOPE_EXCLUDE })) {
    for (const snippet of codeSnippets(readFileSync(file, 'utf8'))) {
      for (const command of yarnCommands(snippet.code)) {
        if (!isKnownCommand(command, known))
          problems.push({ file: `${file}:${snippet.line}`, message: `\`yarn ${command}\` no existe en package.json` });
      }
    }
  }
  return problems;
}

async function main(): Promise<void> {
  const write = process.argv.includes('--write');
  const problems = [...(await checkFigures(write)), ...checkCommands()];
  if (problems.length > 0) {
    console.error(`❌ La documentación cita ${problems.length} cifra(s), marca(s) o comando(s) que no son verdad:`);
    problems.forEach((problem) => console.error(`   - ${problem.file}: ${problem.message}`));
    if (!write) console.error('   Las cifras marcadas se regeneran con "yarn docs:figures"; los comandos se corrigen a mano.');
    process.exit(1);
  }
  console.log('✅ Cifras marcadas y comandos yarn de la documentación coinciden con el código.');
}

main().catch((error: unknown) => {
  console.error('❌ No se pudieron comprobar las cifras de la documentación.', error);
  process.exit(1);
});
