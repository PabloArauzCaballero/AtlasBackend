import { ForbiddenException } from '@nestjs/common';
import { AuthenticatedUser } from '../../types/auth.types.js';

/**
 * ATLAS-AUDIT-027 (cerrado en este patch): antes de este cambio, esta misma verificación
 * ("un cliente autenticado solo puede acceder a sus propios datos") estaba reimplementada de
 * forma independiente en 6-7 servicios distintos (`customers.service.ts`,
 * `customer-privacy.service.ts`, `customer-telemetry.service.ts`, `risk.service.ts`,
 * `sessions.service.ts`, `notifications.service.ts`, e inline en
 * `customer-onboarding.service.ts`), con firmas inconsistentes — incluso con el orden de
 * argumentos invertido en `notifications.service.ts`. Ninguno de esos casos era hoy una
 * vulnerabilidad activa, pero cada nuevo endpoint `:customerId` corría el riesgo de omitir esta
 * verificación por copy-paste manual.
 *
 * A partir de este patch, todos esos módulos deben importar `assertOwnCustomerResource` desde
 * aquí en vez de definir su propia copia local.
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
