import { describe, expect, it } from '@jest/globals';
import { Reflector } from '@nestjs/core';
import { INTERNAL_PERMISSIONS_KEY } from '../../../src/modules/internal-users/internal-permissions.decorator.js';
import { DataQualityController } from '../../../src/modules/data-quality/data-quality.controller.js';

/**
 * La bandeja «Issues de calidad» absorbe la antigua pantalla «Alertas», que el auditor sí podía leer.
 * El auditor tiene `dataQuality.issues.read` y su rol de sesión (`readonly_auditor`) no estaba en la
 * lista: veía el menú y recibía 403. Al abrir el rol se exige el permiso fino, y resolver (incluido
 * reconocer, que antes cualquiera de los nueve roles del portal hacía sin motivo) exige `resolve`.
 */
const reflector = new Reflector();
const prototype = DataQualityController.prototype as unknown as Record<string, () => unknown>;
const handler = (name: string) => prototype[name] as () => unknown;

describe('DataQualityController · permiso fino', () => {
  it('leer exige dataQuality.issues.read y admite al auditor', () => {
    expect(reflector.get(INTERNAL_PERMISSIONS_KEY, handler('listIssues'))).toEqual(['dataQuality.issues.read']);
    expect(reflector.get<string[]>('roles', handler('listIssues'))).toContain('readonly_auditor');
  });

  it('resolver/descartar/reconocer exige dataQuality.issues.resolve y el auditor no puede', () => {
    expect(reflector.get(INTERNAL_PERMISSIONS_KEY, handler('resolveIssue'))).toEqual(['dataQuality.issues.resolve']);
    const roles =
      reflector.get<string[] | undefined>('roles', handler('resolveIssue')) ?? reflector.get<string[]>('roles', DataQualityController);
    expect(roles).not.toContain('readonly_auditor');
  });

  it('el guard que comprueba el permiso está puesto (sin él los decoradores son decorativos)', () => {
    const guards = (reflector.get<Array<{ name: string }>>('__guards__', DataQualityController) ?? []).map((guard) => guard.name);
    expect(guards[guards.length - 1]).toBe('InternalPermissionsGuard');
  });
});
