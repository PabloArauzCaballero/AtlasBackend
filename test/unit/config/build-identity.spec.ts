import { describe, expect, it } from '@jest/globals';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import {
  isCommitSha,
  loadBuildIdentity,
  mergeBuildIdentity,
  parseBuildIdentity,
  readCommitFromGitDir,
} from '../../../src/config/build-identity.js';

const SHA_A = 'a'.repeat(40);
const SHA_B = 'b'.repeat(40);
const BUILT_AT = '2026-09-30T01:02:03.000Z';

describe('mergeBuildIdentity', () => {
  it('lo compilado manda', () => {
    expect(mergeBuildIdentity({ commit: SHA_A, builtAt: BUILT_AT }, {})).toEqual({ commit: SHA_A, builtAt: BUILT_AT });
  });

  it('OP-06: variables de runtime contradictorias NO suplantan lo compilado', () => {
    expect(mergeBuildIdentity({ commit: SHA_A, builtAt: BUILT_AT }, { commit: SHA_B, builtAt: '2020-01-01T00:00:00Z' })).toEqual({
      commit: SHA_A,
      builtAt: BUILT_AT,
    });
  });

  it('OP-06: variables de runtime vacías (Coolify ${SOURCE_COMMIT:-}) no enmascaran lo compilado', () => {
    expect(mergeBuildIdentity({ commit: SHA_A, builtAt: BUILT_AT }, { commit: '', builtAt: '' })).toEqual({
      commit: SHA_A,
      builtAt: BUILT_AT,
    });
  });

  it('OP-01: sin nada válido queda null, nunca cadena vacía ni basura', () => {
    for (const commit of [undefined, '', '  ', 'HEAD', 'abc1234']) {
      expect(mergeBuildIdentity({ commit: null, builtAt: null }, { commit, builtAt: 'ayer' })).toEqual({ commit: null, builtAt: null });
    }
  });

  it('sin dato compilado, rellena con runtime sólo si es un SHA completo y una fecha ISO', () => {
    expect(mergeBuildIdentity({ commit: null, builtAt: null }, { commit: SHA_B, builtAt: BUILT_AT })).toEqual({
      commit: SHA_B,
      builtAt: BUILT_AT,
    });
  });
});

describe('parseBuildIdentity / loadBuildIdentity', () => {
  it('descarta commit y fecha inválidos', () => {
    expect(parseBuildIdentity(JSON.stringify({ commit: 'no-es-sha', builtAt: 'ayer' }))).toEqual({ commit: null, builtAt: null });
    expect(parseBuildIdentity('{roto')).toEqual({ commit: null, builtAt: null });
    expect(parseBuildIdentity('null')).toEqual({ commit: null, builtAt: null });
  });

  it('un archivo ausente da identidad vacía sin lanzar', () => {
    expect(loadBuildIdentity(join(tmpdir(), 'no-existe', 'build-info.json'))).toEqual({ commit: null, builtAt: null });
  });

  it('isCommitSha exige 40 hex en minúsculas', () => {
    expect(isCommitSha(SHA_A)).toBe(true);
    expect(isCommitSha(SHA_A.toUpperCase())).toBe(false);
    expect(isCommitSha(SHA_A.slice(1))).toBe(false);
    expect(isCommitSha(undefined)).toBe(false);
  });
});

describe('readCommitFromGitDir', () => {
  const gitDir = (): string => {
    const dir = mkdtempSync(join(tmpdir(), 'gitdir-'));
    mkdirSync(join(dir, 'refs', 'heads'), { recursive: true });
    return dir;
  };

  it('HEAD desacoplado (así clona Coolify)', () => {
    const dir = gitDir();
    writeFileSync(join(dir, 'HEAD'), `${SHA_A}\n`);
    expect(readCommitFromGitDir(dir)).toBe(SHA_A);
  });

  it('HEAD que apunta a un ref suelto', () => {
    const dir = gitDir();
    writeFileSync(join(dir, 'HEAD'), 'ref: refs/heads/dev\n');
    writeFileSync(join(dir, 'refs', 'heads', 'dev'), `${SHA_B}\n`);
    expect(readCommitFromGitDir(dir)).toBe(SHA_B);
  });

  it('HEAD que apunta a un ref sólo empaquetado', () => {
    const dir = gitDir();
    writeFileSync(join(dir, 'HEAD'), 'ref: refs/heads/dev\n');
    writeFileSync(join(dir, 'packed-refs'), `# pack-refs\n${SHA_A} refs/heads/otra\n${SHA_B} refs/heads/dev\n`);
    expect(readCommitFromGitDir(dir)).toBe(SHA_B);
  });

  it('sin .git o con ref irresoluble da null', () => {
    expect(readCommitFromGitDir(join(tmpdir(), 'nada'))).toBeNull();
    const dir = gitDir();
    writeFileSync(join(dir, 'HEAD'), 'ref: refs/heads/fantasma\n');
    expect(readCommitFromGitDir(dir)).toBeNull();
  });
});

describe('scripts/write-build-info.ts (ejecutado de verdad)', () => {
  const script = resolve(__dirname, '../../../scripts/write-build-info.ts');
  const tsx = resolve(__dirname, '../../../node_modules/.bin/tsx');
  const run = (cwd: string, env: Record<string, string>): { commit: string | null; builtAt: string } => {
    const out = join(cwd, 'dist', 'build-info.json');
    execFileSync(tsx, [script, out], { cwd, env: { PATH: process.env['PATH'] ?? '', ...env }, stdio: 'pipe' });
    return JSON.parse(readFileSync(out, 'utf8')) as { commit: string | null; builtAt: string };
  };

  it('toma SOURCE_COMMIT válido y sella builtAt', () => {
    const info = run(mkdtempSync(join(tmpdir(), 'wbi-')), { SOURCE_COMMIT: SHA_A });
    expect(info.commit).toBe(SHA_A);
    expect(Number.isNaN(Date.parse(info.builtAt))).toBe(false);
  });

  it('SOURCE_COMMIT vacío cae a .git del checkout', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'wbi-'));
    mkdirSync(join(cwd, '.git'));
    writeFileSync(join(cwd, '.git', 'HEAD'), `${SHA_B}\n`);
    expect(run(cwd, { SOURCE_COMMIT: '' }).commit).toBe(SHA_B);
  });

  it('SOURCE_COMMIT basura y sin .git deja null sin fallar el build', () => {
    expect(run(mkdtempSync(join(tmpdir(), 'wbi-')), { SOURCE_COMMIT: 'HEAD' }).commit).toBeNull();
  });
});
