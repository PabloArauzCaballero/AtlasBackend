/**
 * @file Escribe un documento generado o, con `--check`, comprueba que el versionado sigue al día.
 * @business Un documento generado que nadie regenera vuelve a mentir; el gate lo detecta en el PR.
 * @system mismo contrato que `docs:openapi` + «Fail if the committed contract is stale» de CI, pero
 *   sin depender de `git diff`: compara en memoria y no escribe nada en modo comprobación.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

export type GeneratedFile = { path: string; content: string };

function readOrEmpty(path: string): string {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return '';
  }
}

/** Primera línea distinta, para que el fallo diga DÓNDE y no sólo «difiere». */
export function firstDifference(expected: string, actual: string): string {
  const want = expected.split('\n');
  const have = actual.split('\n');
  const length = Math.max(want.length, have.length);
  for (let index = 0; index < length; index += 1) {
    if (want[index] !== have[index]) {
      return `línea ${index + 1}\n      generado:   ${JSON.stringify(want[index] ?? '(fin)')}\n      versionado: ${JSON.stringify(have[index] ?? '(fin)')}`;
    }
  }
  return '(sin diferencias)';
}

/**
 * Sin `--check` escribe los archivos. Con `--check` sale con código 1 si alguno no coincide byte a byte
 * con lo que se generaría ahora, e indica el comando que lo regenera.
 */
export function writeOrCheck(files: readonly GeneratedFile[], regenerateCommand: string, argv: readonly string[] = process.argv): void {
  const check = argv.includes('--check');
  const stale: string[] = [];
  for (const file of files) {
    const absolute = resolve(process.cwd(), file.path);
    if (check) {
      const current = readOrEmpty(absolute);
      if (current !== file.content) stale.push(`${file.path}: ${firstDifference(file.content, current)}`);
      continue;
    }
    mkdirSync(dirname(absolute), { recursive: true });
    writeFileSync(absolute, file.content, 'utf8');
    console.log(`✅ Generado ${file.path}`);
  }
  if (stale.length > 0) {
    console.error(`❌ Documento generado desactualizado. Corre "${regenerateCommand}" y commitea el resultado:`);
    stale.forEach((line) => console.error(`   - ${line}`));
    process.exit(1);
  }
  if (check) console.log(`✅ Al día: ${files.map((file) => file.path).join(', ')}`);
}
