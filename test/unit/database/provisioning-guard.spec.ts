import { describe, expect, it } from '@jest/globals';
import { decideProvisioningExecution, PRODUCTION_OPT_IN_FLAG } from '../../../src/database/provisioning-guard.js';

/**
 * `yarn db:roles:bootstrap` crea roles, cambia contraseñas y reasigna la propiedad de tablas. En
 * producción eso es trabajo de infraestructura con revisión y registro, no del backend (§11). Estas
 * pruebas fijan esa frontera para que no se relaje por accidente.
 */
describe('decideProvisioningExecution', () => {
  const noArgs: readonly string[] = ['node', 'script.ts'];
  const withOptIn: readonly string[] = ['node', 'script.ts', PRODUCTION_OPT_IN_FLAG];

  it.each(['development', 'test'])('permite el aprovisionamiento en %s sin ceremonia', (environment) => {
    const decision = decideProvisioningExecution(environment, noArgs);
    expect(decision.allowed).toBe(true);
    expect(decision.allowed && decision.requiresExplicitOptIn).toBe(false);
  });

  it('bloquea producción cuando no se pasa la bandera explícita', () => {
    const decision = decideProvisioningExecution('production', noArgs);
    expect(decision.allowed).toBe(false);
    expect(decision.allowed === false && decision.reason).toContain(PRODUCTION_OPT_IN_FLAG);
  });

  it('permite producción solo con la bandera explícita, y lo advierte', () => {
    const decision = decideProvisioningExecution('production', withOptIn);
    expect(decision.allowed).toBe(true);
    expect(decision.allowed && decision.requiresExplicitOptIn).toBe(true);
    expect(decision.allowed && decision.notice).toContain('production');
  });

  it('falla cerrado ante un NODE_ENV desconocido o con typo', () => {
    // Un `producton` mal escrito no debe caer en la rama permisiva.
    for (const environment of ['producton', 'staging', 'prod', '']) {
      expect(decideProvisioningExecution(environment, noArgs).allowed).toBe(false);
    }
  });

  it('la bandera no relaja nada en desarrollo: sigue sin requerir opt-in', () => {
    const decision = decideProvisioningExecution('development', withOptIn);
    expect(decision.allowed && decision.requiresExplicitOptIn).toBe(false);
  });

  it('explica en el bloqueo cuál es la vía correcta en producción', () => {
    const decision = decideProvisioningExecution('production', noArgs);
    expect(decision.allowed === false && decision.reason).toMatch(/ops\/postgres\/bootstrap-roles\.sql/);
  });
});
