import { ForbiddenException } from '@nestjs/common';
import { systemsTenantScope } from '../../src/modules/systems-ops/systems-tenant-scope.util.js';

describe('systemsTenantScope', () => {
  it.each(['system_admin', 'platform_admin'] as const)('permite vista global a %s', (role) => {
    expect(systemsTenantScope({ sub: '1', role })).toBeNull();
  });

  it('obliga a un analista local a conservar su tenant', () => {
    expect(systemsTenantScope({ sub: '1', role: 'risk_analyst', tenantId: '7' })).toBe('7');
  });

  it('rechaza actor local sin tenant', () => {
    expect(() => systemsTenantScope({ sub: '1', role: 'compliance_analyst' })).toThrow(ForbiddenException);
  });
});
