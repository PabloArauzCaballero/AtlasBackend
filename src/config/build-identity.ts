/**
 * @file Identidad del artefacto: commit e instante de build sellados en `dist/build-info.json`.
 * @business Permite responder "qué código está sirviendo este contenedor" sin fiarse de una variable
 *   de runtime que el orquestador puede dejar vacía o contradictoria.
 * @system funciones puras (sin importar `env`), para poder probarlas y usarlas desde el script de build.
 *
 * El archivo lo escribe `scripts/write-build-info.ts` UNA vez, en la etapa de build. `APP_COMMIT_SHA`
 * y `APP_BUILT_AT` (variables de runtime) sólo rellenan lo que el archivo no trae; nunca lo pisan. El
 * compose de Coolify las define como `${SOURCE_COMMIT:-}` y `${APP_BUILT_AT:-}`: vacías, anulaban el
 * valor horneado en la imagen y el smoke de TEST veía `commit: null` y `builtAt: null`.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const COMMIT_SHA = /^[0-9a-f]{40}$/;
const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;

export type BuildIdentity = { commit: string | null; builtAt: string | null };

export function isCommitSha(value: unknown): value is string {
  return typeof value === 'string' && COMMIT_SHA.test(value);
}

export function isIsoInstant(value: unknown): value is string {
  return typeof value === 'string' && ISO_INSTANT.test(value) && !Number.isNaN(Date.parse(value));
}

export function parseBuildIdentity(raw: string): BuildIdentity {
  try {
    const parsed: unknown = JSON.parse(raw);
    const record = typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : {};
    return {
      commit: isCommitSha(record['commit']) ? record['commit'] : null,
      builtAt: isIsoInstant(record['builtAt']) ? record['builtAt'] : null,
    };
  } catch {
    return { commit: null, builtAt: null };
  }
}

export function loadBuildIdentity(path: string): BuildIdentity {
  try {
    return parseBuildIdentity(readFileSync(path, 'utf8'));
  } catch {
    return { commit: null, builtAt: null };
  }
}

/** Commit de un checkout leyendo `.git` sin el binario git (la imagen de build no lo trae). */
export function readCommitFromGitDir(gitDir: string): string | null {
  try {
    const head = readFileSync(join(gitDir, 'HEAD'), 'utf8').trim();
    if (isCommitSha(head)) return head;
    const ref = /^ref:\s*(\S+)$/.exec(head)?.[1];
    if (!ref) return null;
    try {
      const loose = readFileSync(join(gitDir, ref), 'utf8').trim();
      if (isCommitSha(loose)) return loose;
    } catch {
      // el ref puede estar sólo en packed-refs
    }
    for (const line of readFileSync(join(gitDir, 'packed-refs'), 'utf8').split('\n')) {
      const [sha, name] = line.trim().split(' ');
      if (name === ref && isCommitSha(sha)) return sha;
    }
    return null;
  } catch {
    return null;
  }
}

/** Lo compilado manda; lo de runtime sólo rellena si es válido y el artefacto no trae el dato. */
export function mergeBuildIdentity(
  compiled: BuildIdentity,
  runtime: { commit?: string | undefined; builtAt?: string | undefined },
): BuildIdentity {
  const runtimeCommit = runtime.commit?.trim();
  const runtimeBuiltAt = runtime.builtAt?.trim();
  return {
    commit: compiled.commit ?? (isCommitSha(runtimeCommit) ? runtimeCommit : null),
    builtAt: compiled.builtAt ?? (isIsoInstant(runtimeBuiltAt) ? runtimeBuiltAt : null),
  };
}
