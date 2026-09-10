import { Reflector } from '@nestjs/core';
import { ROLES_KEY } from '../../src/common/decorators/roles.decorator.js';
import { INTERNAL_PERMISSIONS_KEY } from '../../src/modules/internal-users/internal-permissions.decorator.js';
import { SystemFlowsReviewController } from '../../src/modules/systems-ops/system-flows-review.controller.js';
import { SystemFlowsController } from '../../src/modules/systems-ops/system-flows.controller.js';
import { SystemsOpsModule } from '../../src/modules/systems-ops/systems-ops.module.js';

/**
 * La revisión de flujos se publicó con un permiso al que no llegaba nadie a quien iba dirigido: el paquete
 * `DATA_GOVERNANCE_MANAGER` inicia sesión como `internal_operator`, y los roles de clase no lo admitían.
 * Lo que se protege: el rol grueso deja pasar a la comprobación del permiso fino, y el fino sigue ahí.
 */
const reflector = new Reflector();
const metodo = (nombre: string) => (SystemFlowsReviewController.prototype as unknown as Record<string, () => unknown>)[nombre];

describe('SystemFlowsReviewController · quién llega y qué decide', () => {
  it.each([
    ['documentationGate', 'systems.flows.read'],
    ['reviewQueue', 'systems.flows.read'],
    ['reviewFlow', 'systems.flows.review'],
  ])('%s exige %s', (nombre, permiso) => {
    expect(reflector.get<string[]>(INTERNAL_PERMISSIONS_KEY, metodo(nombre))).toEqual([permiso]);
  });

  it('cada ruta admite internal_operator, que es el rol de sesión del paquete que revisa', () => {
    for (const nombre of ['documentationGate', 'reviewQueue', 'reviewFlow']) {
      expect(reflector.get<string[]>(ROLES_KEY, metodo(nombre))).toEqual(expect.arrayContaining(['internal_operator', 'system_admin']));
    }
  });

  it('ningún método se queda sin permiso fino: el rol grueso no puede ser lo único que se comprueba', () => {
    const metodos = Object.getOwnPropertyNames(SystemFlowsReviewController.prototype).filter((nombre) => nombre !== 'constructor');
    expect(metodos.filter((nombre) => !reflector.get(INTERNAL_PERMISSIONS_KEY, metodo(nombre)))).toEqual([]);
  });

  it('el guard de permisos corre después de los de sesión', () => {
    const guards = (reflector.get<Array<{ name: string }>>('__guards__', SystemFlowsReviewController) ?? []).map((g) => g.name);
    expect(guards[0]).toBe('JwtAuthGuard');
    expect(guards.indexOf('InternalPermissionsGuard')).toBe(guards.length - 1);
  });

  it('se registra ANTES que el controlador de flujos: si no, `flows/:flowId` se come sus GET', () => {
    const controladores = Reflect.getMetadata('controllers', SystemsOpsModule) as unknown[];
    expect(controladores.indexOf(SystemFlowsReviewController)).toBeGreaterThanOrEqual(0);
    expect(controladores.indexOf(SystemFlowsReviewController)).toBeLessThan(controladores.indexOf(SystemFlowsController));
  });
});
