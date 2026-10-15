/**
 * @file Utilidad: autorización propia de las notificaciones.
 * @business Esta pieza entrega mensajes oportunos y respetuosos de preferencias por canales configurables.
 * @system orquesta reglas, plantillas, audiencias, persistencia y adaptadores multicanal resilientes.
 */
import { ForbiddenException } from '@nestjs/common';
import { AuthenticatedUser } from '../../common/types/auth.types.js';

/**
 * Las notificaciones usan una autorización más estricta que el helper genérico de ownership:
 * solo el cliente dueño o una lista explícita de roles internos puede leer/gestionar mensajes.
 */
function canAccessCustomer(currentUser: AuthenticatedUser, customerId: string): boolean {
  if (currentUser.role === 'customer') return currentUser.customerId === customerId;
  return ['internal_operator', 'risk_analyst', 'compliance_analyst', 'fraud_analyst', 'admin', 'platform_admin', 'system'].includes(
    currentUser.role,
  );
}

export function assertCustomerAccess(currentUser: AuthenticatedUser, customerId: string): void {
  if (!canAccessCustomer(currentUser, customerId)) throw new ForbiddenException('CUSTOMER_NOTIFICATION_ACCESS_DENIED');
}

export function requireInternalUserId(currentUser: AuthenticatedUser): string {
  if (!currentUser.internalUserId) throw new ForbiddenException('INTERNAL_USER_TOKEN_REQUIRED');
  return currentUser.internalUserId;
}
