/**
 * Escribe `dist/build-info.json` con el commit compilado y el instante del build.
 *
 * Se ejecuta en la etapa de build, después de `yarn build`. El commit sale, por este orden, de:
 *   1. el argumento de build `SOURCE_COMMIT` (Coolify lo define) si es un SHA de 40 hex;
 *   2. `.git` del checkout dentro del contexto de build (sólo HEAD, packed-refs y refs; ver .dockerignore).
 * Si ninguno da un SHA válido escribe `commit: null` y NO falla el build: la identidad no se inventa y el
 * smoke de release rechaza un servicio cuyo commit no coincide con el candidato.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { isCommitSha, readCommitFromGitDir, type BuildIdentity } from '../src/config/build-identity.js';

const out = resolve(process.argv[2] ?? 'dist/build-info.json');
const fromArg = process.env['SOURCE_COMMIT']?.trim();
const identity: BuildIdentity & { builtAt: string } = {
  commit: isCommitSha(fromArg) ? fromArg : readCommitFromGitDir(resolve('.git')),
  builtAt: new Date().toISOString(),
};

mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, `${JSON.stringify(identity, null, 2)}\n`);
console.log(`build-info: commit=${identity.commit ?? 'NO DETERMINADO'} builtAt=${identity.builtAt} -> ${out}`);
