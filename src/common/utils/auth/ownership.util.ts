import { ForbiddenException } from '@nestjs/common';
import { AuthenticatedUser } from '../../types/auth.types.js';
import { isInternalOperationalRole } from './role-groups.util.js';

/**
 * Verificación única de ownership para endpoints `:customerId`.
 *
 * Un cliente autenticado solo puede acceder a sus propios datos; los roles internos se autorizan
 * en la capa de roles del endpoint.
 */
export function assertOwnCustomerResource(currentUser: AuthenticatedUser, customerId: string): void {
  if (currentUser.role === 'customer' && currentUser.customerId !== customerId) {
    throw new ForbiddenException('El token del cliente no corresponde al recurso solicitado.');
  }
}

/**
 * Variante estricta: además de bloquear el acceso cruzado entre clientes, exige que el actor
 * autenticado sea efectivamente un `customer` (no un rol interno) para el recurso dado. Útil en
 * endpoints que son exclusivamente de autoservicio del cliente (por ejemplo, cerrar su propia
 * sesión), donde ni siquiera un `internal_operator` debería poder invocarlos en nombre de otro.
 */
export function assertIsOwningCustomer(currentUser: AuthenticatedUser, customerId: string): void {
  if (currentUser.role !== 'customer' || currentUser.customerId !== customerId) {
    throw new ForbiddenException('Este recurso solo puede ser accedido por el cliente propietario.');
  }
}

/**
 * Variante estricta para onboarding: solo cliente dueño o rol operacional interno.
 */
export function assertOwnCustomerResourceOrInternalOperational(currentUser: AuthenticatedUser, customerId: string): void {
  if (isInternalOperationalRole(currentUser.role)) return;
  if (currentUser.role !== 'customer' || currentUser.customerId !== customerId) {
    throw new ForbiddenException('El token no permite operar sobre este cliente.');
  }
}
