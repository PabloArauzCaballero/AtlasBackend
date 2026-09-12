/**
 * @file AT-050 — un gate que necesita la base no puede aprobar sin ella (prueba en NEGATIVO).
 * @business El verde de CI tiene que significar «se comprobó»; un job sin PostgreSQL, con credenciales
 *   mal puestas o con una selección de pruebas que no encuentra nada no puede pasar por validación.
 * @system Procesos reales (`tsx`, `jest`) con la política de `scripts/gate-skip-policy.ts` y de
 *   `test/integration/support/database.ts` (ATLAS-CI-002): sin `ATLAS_GATES_ALLOW_SKIP=true` la base
 *   inalcanzable es un fallo con código de salida; con la bandera, un salto visible. Una selección de
 *   jest que descubre cero pruebas sale con código 1. Y ningún script del repositorio ni el workflow
 *   piden el salto.
 */
import { describe, expect, it } from '@jest/globals';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { gateSkipIsAllowed } from '../../../scripts/gate-skip-policy.js';

const ROOT = join(__dirname, '..', '..', '..');
const TSX = join(ROOT, 'node_modules', '.bin', 'tsx');
const JEST = join(ROOT, 'node_modules', '.bin', 'jest');
const OPEN_DATABASE_SCRIPT = `
  import { openIntegrationDatabase } from './test/integration/support/database.ts';
  openIntegrationDatabase().then(
    (db) => { console.log(db ? 'OPENED' : 'SKIPPED'); process.exit(db ? 0 : 0); },
    (error) => { console.error(error.message); process.exit(3); },
  );
`;

/** Base inalcanzable: puerto 1 en loopback (nadie escucha; el rechazo es inmediato). */
function openAgainstDeadDatabase(extraEnv: Record<string, string | undefined>) {
  const env: Record<string, string | undefined> = {
    ...process.env,
    DB_HOST: '127.0.0.1',
    DB_PORT: '1',
    DB_NAME: 'atlas_test',
    ATLAS_TEST_DATABASE_ISOLATED: 'true',
    ATLAS_GATES_ALLOW_SKIP: undefined,
    ...extraEnv,
  };
  return spawnSync(TSX, ['-e', OPEN_DATABASE_SCRIPT], { cwd: ROOT, env, encoding: 'utf8', timeout: 60_000 });
}

describe('AT-050 · gates de base de datos obligatorios', () => {
  it('sin pedir el salto, la política no lo concede (ni por NODE_ENV=test)', () => {
    const previous = process.env.ATLAS_GATES_ALLOW_SKIP;
    delete process.env.ATLAS_GATES_ALLOW_SKIP;
    try {
      expect(gateSkipIsAllowed()).toBe(false);
    } finally {
      if (previous !== undefined) process.env.ATLAS_GATES_ALLOW_SKIP = previous;
    }
  });

  it('base apagada en modo requerido: el proceso termina con código distinto de cero y dice por qué', () => {
    const run = openAgainstDeadDatabase({});
    expect(run.status).toBe(3);
    expect(run.stderr).toMatch(/necesitan PostgreSQL/);
    expect(run.stdout).not.toContain('OPENED');
  });

  it('base apagada con salto explícito: sale en verde pero el salto es VISIBLE, no un aprobado', () => {
    const run = openAgainstDeadDatabase({ ATLAS_GATES_ALLOW_SKIP: 'true' });
    expect(run.status).toBe(0);
    expect(run.stdout).toContain('SKIPPED');
    expect(run.stderr).toMatch(/\[skip\] integración/);
  });

  it('una selección que descubre cero pruebas falla (no existe passWithNoTests)', () => {
    const run = spawnSync(JEST, ['--config', 'jest.integration.config.cjs', '--testPathPatterns', 'no-such-suite-at-050-[0-9]+'], {
      cwd: ROOT,
      env: { ...process.env, CI: 'true' },
      encoding: 'utf8',
      timeout: 120_000,
    });
    expect(run.status).toBe(1);
    expect(`${run.stdout}${run.stderr}`).toMatch(/No tests found/);
  });

  it('ningún script del repositorio ni el workflow de CI piden el salto o toleran cero pruebas', () => {
    const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as { scripts: Record<string, string> };
    for (const [name, command] of Object.entries(pkg.scripts)) {
      expect(`${name}: ${command}`).not.toMatch(/--passWithNoTests|--allow-skip|ATLAS_GATES_ALLOW_SKIP/);
    }
    // Sin comentarios: el workflow EXPLICA la política; lo que no puede es pedirla.
    const workflow = readFileSync(join(ROOT, '.github', 'workflows', 'ci.yml'), 'utf8')
      .split('\n')
      .filter((line) => !line.trim().startsWith('#'))
      .join('\n');
    expect(workflow).not.toMatch(/ATLAS_GATES_ALLOW_SKIP|--allow-skip|--passWithNoTests/);
    // Los tres grupos de pruebas que el plan hace obligatorios están registrados como scripts.
    for (const script of ['test:architecture', 'test:contracts', 'test:integration']) {
      expect(pkg.scripts[script]).toBeDefined();
      expect(workflow).toContain(`yarn ${script}`);
    }
  });
});
