import { ForbiddenException } from '@nestjs/common';
import { AuthenticatedUser } from '../../common/types/auth.types.js';
import { canReadAllSystemsOpsTenants } from './systems-ops.constants.js';

/** null means platform-wide access; a string always means an enforced tenant predicate. */
export function systemsTenantScope(user: AuthenticatedUser): string | null {
  if (canReadAllSystemsOpsTenants(user.role)) return null;
  if (!user.tenantId) throw new ForbiddenException('SYSTEMS_OPS_TENANT_SCOPE_REQUIRED');
  return user.tenantId;
}
