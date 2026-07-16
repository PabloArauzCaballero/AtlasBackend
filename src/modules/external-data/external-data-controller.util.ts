import { ForbiddenException } from '@nestjs/common';
import { AuthenticatedUser } from '../../common/types/auth.types.js';
import { assertOwnCustomerResource } from '../../common/utils/auth/ownership.util.js';

/**
 * Helpers compartidos por los controllers de external-data.
 *
 * Extraídos de `external-data.controller.ts` (Fase 2.2 del plan 10/10) sin cambios: ese archivo
 * agrupaba 9 clases de controller y estos helpers eran privados del módulo. Al separar los verticales
 * en archivos propios, pasan a ser compartidos explícitamente.
 */

export function actorId(currentUser: AuthenticatedUser): string | undefined {
  return currentUser.internalUserId ?? currentUser.platformUserId ?? currentUser.customerId;
}

export function assertCustomerAccess(currentUser: AuthenticatedUser, customerId?: string): void {
  if (customerId) assertOwnCustomerResource(currentUser, customerId);
}

export function customerScopeForConsentMutation(currentUser: AuthenticatedUser): string | undefined {
  if (currentUser.role !== 'customer') return undefined;
  if (!currentUser.customerId) throw new ForbiddenException('El token de cliente no contiene customerId.');
  return currentUser.customerId;
}
