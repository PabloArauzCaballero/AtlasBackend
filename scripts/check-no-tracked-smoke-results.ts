import { execFileSync } from 'node:child_process';

/**
 * ATLAS-P0-SMOKE-001: gate que corre en CI antes de los tests. `.gitignore` evita que alguien
 * trackee estos archivos por accidente en el flujo normal, pero no evita un `git add -f` explícito
 * ni protege commits ya hechos en una rama que no pasó por este check. Este script es la
 * verificación positiva: falla el build si cualquiera de los patrones prohibidos aparece en
 * `git ls-files`, sin importar cómo haya llegado ahí.
 */
const FORBIDDEN_PATTERNS = ['scripts/smoke/smoke-results.json', 'scripts/smoke/*.results.json', 'scripts/smoke/results'];

function trackedFilesMatching(pattern: string): string[] {
  try {
    const output = execFileSync('git', ['ls-files', '--', pattern], { encoding: 'utf-8' });
    return output
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
  } catch (error) {
    throw new Error(`No se pudo ejecutar "git ls-files -- ${pattern}": ${error instanceof Error ? error.message : String(error)}`);
  }
}

function main(): void {
  const violations = FORBIDDEN_PATTERNS.flatMap((pattern) => trackedFilesMatching(pattern));

  if (violations.length > 0) {
    console.error('[check:smoke-results-untracked] Se encontraron resultados de smoke rastreados por Git:');
    for (const file of violations) console.error(`  - ${file}`);
    console.error(
      '\nEstos archivos deben permanecer fuera del índice (ver .gitignore). Corre: ' +
        `git rm --cached ${violations.map((file) => `"${file}"`).join(' ')}`,
    );
    process.exit(1);
  }

  console.log('[check:smoke-results-untracked] OK — ningún resultado de smoke está rastreado por Git.');
}

main();
