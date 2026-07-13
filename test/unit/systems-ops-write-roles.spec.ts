import { SYSTEMS_OPS_GOVERNANCE_ROLES, SYSTEMS_OPS_WRITE_ROLES } from '../../src/modules/systems-ops/systems-ops.constants.js';

/**
 * ATLAS-AUDIT (auditoría #16, `systems-ops`): los 18 endpoints de escritura del módulo
 * (crear/editar suites y steps de test, disparar runs reales, decidir revisiones, encolar stress
 * runs) usaban el mismo `@Roles(...SYSTEMS_OPS_ROLES)` que los de solo lectura, incluyendo
 * `readonly_auditor` — un rol cuyo nombre declara explícitamente que no debería poder escribir.
 * Este test fija el contrato de `SYSTEMS_OPS_WRITE_ROLES` para que una futura adición a
 * `SYSTEMS_OPS_ROLES` no vuelva a colar `readonly_auditor` (u otro rol de solo lectura) en el
 * conjunto de escritura sin que alguien lo note explícitamente.
 */
describe('SYSTEMS_OPS_WRITE_ROLES', () => {
  it('excludes readonly_auditor', () => {
    expect(SYSTEMS_OPS_WRITE_ROLES).not.toContain('readonly_auditor');
  });

  it('is narrowed to governance roles for backward compatibility', () => {
    expect([...SYSTEMS_OPS_WRITE_ROLES].sort()).toEqual([...SYSTEMS_OPS_GOVERNANCE_ROLES].sort());
  });
});
