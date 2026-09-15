/**
 * @file Utilidad pura o acotada reutilizable dentro de su capa.
 * @business Esta pieza aplica controles coherentes a todos los dominios y reduce fallas repetidas entre equipos.
 * @system provee infraestructura transversal de auth sin introducir reglas de un dominio específico.
 */
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

/**
 * Propiedad del expediente de partner, para endpoints `:partnerId`.
 *
 * El onboarding del comercio es autoservicio: sus endpoints admiten el rol `merchant`, y el
 * expediente se identifica por un id de la URL. Sin esta comprobación, un comercio autenticado
 * podía leer y modificar el expediente de CUALQUIER otro comercio del mismo tenant —sus
 * representantes legales, sus terminales y sus QR de cobro, que dicen a qué cuenta va el dinero—.
 * Encontrado por la revisión de seguridad del 20-ago-2026 sobre el módulo recién creado.
 *
 * Un expediente SIN dueño no es de todos: es de nadie. Los abrió personal interno, o existían
 * antes de que hubiera columna de dueño, y dejarlos abiertos a cualquier comercio reproduciría el
 * mismo agujero para el histórico. Se tratan como internos hasta que alguien los reasigne.
 */
export function assertOwnPartnerResource(currentUser: AuthenticatedUser, ownerMerchantUserId: string | null): void {
  if (isInternalOperationalRole(currentUser.role)) return;
  if (currentUser.role !== 'merchant' || !currentUser.merchantUserId) {
    throw new ForbiddenException('El token no permite operar sobre expedientes de partner.');
  }
  if (ownerMerchantUserId === null || currentUser.merchantUserId !== ownerMerchantUserId) {
    throw new ForbiddenException('El expediente de partner no pertenece a este comercio.');
  }
}
