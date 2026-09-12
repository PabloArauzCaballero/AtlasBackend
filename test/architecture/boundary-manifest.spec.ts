/**
 * @file Valida el manifiesto de fronteras (AT-011): estructura, excepciones y ausencia de comodines.
 * @business Una excepción sin dueño ni tarea de retirada es deuda que nadie va a pagar; un comodín
 *   convierte el manifiesto en decoración.
 * @system Casos negativos sobre copias mutadas del manifiesto real, más la validación del real.
 */
import { describe, expect, it } from '@jest/globals';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { validateManifest, type BoundaryManifest } from '../../scripts/architecture/boundaries.js';

const rootDir = resolve(__dirname, '../..');
const real = JSON.parse(readFileSync(resolve(rootDir, 'config/architecture/boundaries.json'), 'utf8')) as BoundaryManifest;
const moduleDirs = readdirSync(resolve(rootDir, 'src/modules'), { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name);

const clone = (): BoundaryManifest => JSON.parse(JSON.stringify(real)) as BoundaryManifest;

describe('manifiesto de fronteras (AT-011)', () => {
  it('el manifiesto real es válido contra el árbol actual de módulos', () => {
    expect(validateManifest(real, moduleDirs)).toEqual([]);
  });

  it('una excepción sin responsable o sin tarea de retirada invalida el manifiesto', () => {
    const manifest = clone();
    manifest.exceptions.push({
      id: 'sin-dueno',
      kind: 'legacy-dependency',
      from: 'credit',
      to: ['risk'],
      owner: '',
      task: 'pendiente',
      expires: '2027-01-01',
      reason: 'x',
    });
    const errors = validateManifest(manifest, moduleDirs);
    expect(errors).toEqual(expect.arrayContaining(['excepcion_sin_responsable:sin-dueno', 'excepcion_sin_tarea_de_retirada:sin-dueno']));
  });

  it('una carpeta nueva sin contexto hace fallar la validación y la nombra', () => {
    expect(validateManifest(real, [...moduleDirs, 'modulo-nuevo'])).toEqual(['carpeta_sin_contexto:modulo-nuevo']);
  });

  it('un permiso comodín se rechaza, tanto en dependencias como en excepciones', () => {
    const manifest = clone();
    manifest.modules.credit.allowedDependencies.push('*');
    manifest.exceptions.push({
      id: 'todo',
      kind: 'legacy-dependency',
      from: 'credit',
      to: ['*'],
      owner: 'x',
      task: 'AT-999',
      expires: '2027-01-01',
      reason: 'x',
    });
    const errors = validateManifest(manifest, moduleDirs);
    expect(errors).toEqual(expect.arrayContaining(['comodin_prohibido:credit→*', 'comodin_prohibido:todo']));
  });

  it('cada excepción vigente apunta a módulos existentes y tiene vencimiento con fecha', () => {
    const manifest = clone();
    manifest.exceptions[0].to.push('modulo-fantasma');
    manifest.exceptions[0].expires = 'algún día';
    const errors = validateManifest(manifest, moduleDirs);
    expect(errors).toEqual(
      expect.arrayContaining([
        `excepcion_destino_desconocido:${manifest.exceptions[0].id}→modulo-fantasma`,
        `excepcion_sin_vencimiento:${manifest.exceptions[0].id}`,
      ]),
    );
  });

  it('el puente atómico del alta y el ciclo auth↔mensajería están declarados con dueño y tarea (no regenerados)', () => {
    const ids = real.exceptions.map((exception) => exception.id);
    expect(ids).toEqual(expect.arrayContaining(['onboarding-atomic-bridge', 'auth-mail-cycle']));
    for (const exception of real.exceptions) expect(exception.task).toMatch(/^AT-\d{3}$/);
  });
});
