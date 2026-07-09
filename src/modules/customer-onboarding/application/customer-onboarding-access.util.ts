import { ForbiddenException } from '@nestjs/common';
import { AuthenticatedUser } from '../../../common/types/auth.types.js';
import { isInternalOperationalRole } from '../../../common/utils/auth/role-groups.util.js';

export function assertCustomerOnboardingScope(customerId: string, currentUser: AuthenticatedUser): void {
  if (isInternalOperationalRole(currentUser.role)) return;
  if (currentUser.role !== 'customer' || currentUser.customerId !== customerId) {
    throw new ForbiddenException('El token no permite operar sobre este cliente.');
  }
}
