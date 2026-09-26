/**
 * @file Prueba negativa de cada gate del catálogo de procesos.
 * @business Un gate que nunca falla es un verde que miente: aquí se comprueba que cada uno rompe con la fixture rota que le toca.
 * @system escribe fixtures rotas en un directorio temporal y corre los scripts con `PROCESS_FIXTURES`.
 */
import { describe, expect, it } from '@jest/globals';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const BASE = {
  processId: 'P-98',
  code: 'prueba_gate',
  version: 'v1',
  name: 'Proceso roto a propósito',
  description: 'x',
  processType: 'back_office',
  ownerDomain: 'testing',
  ownerRole: 'QA_ENGINEER',
  priority: 'P2',
  systems: ['ATLAS_BACKEND'],
  narrative: {
    whyExists: 'Existe para comprobar que los gates del catálogo de procesos fallan cuando la fixture está rota de verdad.',
    whoStartsAndCloses: 'Lo inicia la batería de pruebas unitarias del repositorio y lo cierra ella misma al terminar la comprobación.',
    startAndEnd: 'Empieza cuando jest escribe la fixture en un directorio temporal y termina cuando el gate devuelve su código de salida.',
    whenItFails: 'Si el gate no falla con la fixture rota, la prueba se pone en rojo: el gate ya no protege lo que dice proteger.',
    healthIndicator: 'Cada gate devuelve un código distinto de cero con su fixture rota y cero con la fixture correcta del registro.',
  },
  success: 's',
  failure: 'f',
  sources: ['test/unit/workflow-catalog/process-gates.spec.ts'],
  stages: [
    {
      code: 'unica',
      name: 'Única',
      description: 'x',
      module: 'workflow_catalog',
      actor: 'system',
      client: 'BLOCK',
      steps: [{ code: 'a', name: 'A', description: 'x', method: 'GET', path: '/workflows' }],
    },
  ],
};

function run(script: string, fixture: unknown): number {
  const dir = mkdtempSync(join(tmpdir(), 'process-gate-'));
  const file = join(dir, 'roto.process.fixtures.ts');
  writeFileSync(file, `export const ROTO = ${JSON.stringify(fixture)};\n`);
  const result = spawnSync('npx', ['tsx', `scripts/processes/${script}`], {
    env: { ...process.env, PROCESS_FIXTURES: file },
    encoding: 'utf8',
  });
  return result.status ?? -1;
}

describe('gates del catálogo de procesos', () => {
  it('la fixture de base pasa los dos gates (si no, las negativas no dirían nada)', () => {
    expect(run('check-process-narratives.ts', BASE)).toBe(0);
    expect(run('check-process-steps.ts', BASE)).toBe(0);
  }, 120_000);

  it('check:process-narratives falla con una narrativa corta', () => {
    expect(run('check-process-narratives.ts', { ...BASE, narrative: { ...BASE.narrative, whenItFails: 'falla' } })).toBe(1);
  }, 60_000);

  it('check:process-narratives falla con un dueño que no es un rol', () => {
    expect(run('check-process-narratives.ts', { ...BASE, ownerRole: 'EL_JEFE' })).toBe(1);
  }, 60_000);

  it('check:process-steps falla con una ruta que nadie sirve', () => {
    const stages = [{ ...BASE.stages[0], steps: [{ code: 'a', name: 'A', description: 'x', method: 'GET', path: '/no/existe/nunca' }] }];
    expect(run('check-process-steps.ts', { ...BASE, stages })).toBe(1);
  }, 60_000);

  it('check:process-steps falla con un paso manual sin motivo', () => {
    const stages = [{ ...BASE.stages[0], steps: [{ code: 'a', name: 'A', description: 'x', kind: 'manual' }] }];
    expect(run('check-process-steps.ts', { ...BASE, stages })).toBe(1);
  }, 60_000);

  it('check:process-sync falla si una fixture del registro cambia sin su migración', () => {
    // Con PROCESS_FIXTURES el gate ve un proceso que no está en el candado: exactamente el caso a cazar.
    expect(run('check-process-sync.ts', BASE)).toBe(1);
  }, 60_000);
});
