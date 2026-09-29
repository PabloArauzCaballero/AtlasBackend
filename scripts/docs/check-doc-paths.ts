/**
 * @file Gate: toda ruta de archivo que la documentación cita como código existe en el repositorio.
 * @business La documentación mandaba a leer `docs/operations/…`, `src/…/x.service.ts` y scripts que ya no
 *   estaban: quien los busca pierde el tiempo y, peor, concluye que la garantía que describían existe.
 * @system `yarn check:doc-paths` lee los spans de código EN LÍNEA de los `.md` versionados y comprueba
 *   que cada ruta con forma de archivo del repositorio (`src/…`, `scripts/…`, `test/…`, `docs/…`, `ops/…`,
 *   `.github/…`, `asyncapi/…`, `config/…`, `deploy/…` o un archivo de la raíz) esté en el árbol.
 *
 * Reglas:
 *  - `ruta:123` y `ruta#L10` valen por `ruta`. Un comodín (`src/modules/*\/x.ts`) vale si existe el
 *    directorio fijo que lo precede. Las rutas con `<…>`, `{…}` o `…`/`...` son plantillas: no se comprueban.
 *  - Una ruta que `.gitignore` excluye (`.env`, `scripts/smoke/results/`) es un artefacto local: se cita
 *    para decir que no se versiona y no se exige.
 *  - Fuera de alcance, por ser registros FECHADOS que no se reescriben: `docs/audit/**`, `evidencia/**`,
 *    `CHANGELOG.md` y `.claude/**` (plantillas compartidas con otros repositorios).
 *  - Una ruta que ya no existe y que el texto cita justamente para decir que se retiró se escribe SIN
 *    formato de código o, si hace falta el span, con la palabra `retirado`/`retirada` en la misma línea.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname } from 'node:path';
import { codeSnippets, trackedMarkdown } from './lib/markdown.js';

const SCOPE_EXCLUDE = ['docs/audit/', 'evidencia/', 'CHANGELOG.md', '.claude/'];
const ROOT_DIRS = ['src', 'scripts', 'test', 'docs', 'ops', 'asyncapi', 'config', 'deploy', '.github'];
const ROOT_FILE =
  /^(?:package\.json|tsconfig[\w.-]*\.json|docker-compose[\w.-]*\.ya?ml|Dockerfile[\w.-]*|\.env[\w.-]*|mkdocs\.yml|README\.md|CONTRIBUTING\.md|eslint\.config\.mjs)$/;

/** Ruta del repositorio que el span promete, o null si el span no es una ruta de archivo. */
export function citedPath(code: string): string | null {
  const text = code.trim().replace(/^\.\//, '');
  if (/[\s<>{}|]|\.\.\.|…/.test(text)) return null;
  const path = text.replace(/(?::\d+(?:-\d+)?|#L\d+(?:-L?\d+)?)$/, '');
  if (ROOT_FILE.test(path)) return path;
  const [first, ...rest] = path.split('/');
  if (!ROOT_DIRS.includes(first) || rest.length === 0) return null;
  // Una carpeta (`src/modules/`) o un archivo con extensión; `docs/foo` sin extensión ni barra final es prosa.
  return /\.[A-Za-z0-9]+$/.test(path) || path.endsWith('/') ? path : null;
}

/** Un artefacto local que `.gitignore` excluye (`.env`, `scripts/smoke/results/`) se cita para decir que NO se versiona. */
export function isIgnored(path: string): boolean {
  try {
    execFileSync('git', ['check-ignore', '-q', path.replace(/\*.*$/, '')]);
    return true;
  } catch {
    return false;
  }
}

/** Un comodín vale si el directorio fijo que lo precede existe. */
export function pathExists(path: string): boolean {
  const star = path.indexOf('*');
  if (star === -1) return existsSync(path);
  const fixed = path.slice(0, star);
  const dir = fixed.endsWith('/') ? fixed : dirname(fixed);
  return existsSync(dir) && statSync(dir).isDirectory() && readdirSync(dir).length > 0;
}

function main(): void {
  const problems: string[] = [];
  let checked = 0;
  for (const file of trackedMarkdown({ exclude: SCOPE_EXCLUDE })) {
    const lines = readFileSync(file, 'utf8').split('\n');
    for (const snippet of codeSnippets(lines.join('\n')).filter((candidate) => candidate.inline)) {
      const path = citedPath(snippet.code);
      if (path === null) continue;
      if (/retirad[oa]s?|ya no existe|elimin(?:ad[oa]s?|[óo])|borrad[oa]s?/i.test(lines[snippet.line - 1])) continue;
      checked += 1;
      if (!pathExists(path) && !isIgnored(path)) problems.push(`${file}:${snippet.line}: \`${snippet.code}\` no existe en el repositorio`);
    }
  }
  if (problems.length > 0) {
    console.error(`❌ ${problems.length} ruta(s) de archivo citada(s) en la documentación no existen:`);
    problems.forEach((problem) => console.error(`   - ${problem}`));
    console.error('   Corrige la ruta, o, si el texto la cita para decir que se retiró, dilo en la misma línea («retirado»).');
    process.exit(1);
  }
  console.log(`✅ ${checked} ruta(s) de archivo citada(s) en la documentación existen.`);
}

if (process.argv[1] !== undefined && /check-doc-paths\.[tj]s$/.test(process.argv[1])) main();
