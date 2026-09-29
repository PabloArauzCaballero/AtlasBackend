/**
 * @file Lectura mínima de Markdown para los gates de documentación: código citado y archivos en alcance.
 * @business Un comando o una ruta que la documentación cita como código es una promesa comprobable.
 * @system extrae spans de código en línea y líneas de bloques cercados, con su número de línea.
 */
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';

export type CodeSnippet = { code: string; line: number; inline: boolean };

/** Spans `así` y líneas de bloques ``` / ~~~ . El texto corrido no cuenta: «yarn» en prosa no es un comando. */
export function codeSnippets(markdown: string): CodeSnippet[] {
  const snippets: CodeSnippet[] = [];
  let fence: string | null = null;
  markdown.split('\n').forEach((text, index) => {
    const line = index + 1;
    const fenceMatch = /^\s*(```+|~~~+)/.exec(text);
    if (fenceMatch) {
      if (fence === null) fence = fenceMatch[1][0];
      else if (fenceMatch[1][0] === fence) fence = null;
      return;
    }
    if (fence !== null) {
      snippets.push({ code: text, line, inline: false });
      return;
    }
    for (const match of text.matchAll(/(`+)(?!`)(.+?)(?<!`)\1(?!`)/g)) snippets.push({ code: match[2].trim(), line, inline: true });
  });
  return snippets;
}

/**
 * Archivos Markdown del repositorio (versionados y nuevos no ignorados: lo que verá CI tras el commit),
 * filtrados por prefijos de inclusión y de exclusión.
 */
export function trackedMarkdown(options: { include?: readonly string[]; exclude?: readonly string[] } = {}): string[] {
  const files = [
    ...new Set(
      execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '*.md'], { encoding: 'utf8' })
        .split('\n')
        // Un archivo borrado del árbol pero aún en el índice no es documentación: se salta.
        .filter((file) => file.length > 0 && existsSync(file)),
    ),
  ];
  const matches = (file: string, prefix: string): boolean => (prefix.endsWith('/') ? file.startsWith(prefix) : file === prefix);
  return files.filter(
    (file) =>
      (options.include === undefined || options.include.some((prefix) => matches(file, prefix))) &&
      !(options.exclude ?? []).some((prefix) => matches(file, prefix)),
  );
}
