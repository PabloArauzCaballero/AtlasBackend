import { SYSTEMS_OPS_GOVERNANCE_ROLES, SYSTEMS_OPS_WRITE_ROLES } from '../../src/modules/systems-ops/systems-ops.constants.js';

/**
 * Los endpoints de escritura de systems-ops no deben admitir `readonly_auditor`.
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
