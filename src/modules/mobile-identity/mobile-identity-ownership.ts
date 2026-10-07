/**
 * @file Dueño de un intento de verificación de identidad.
 * @business Un cliente sólo puede ver su propia verificación: lo leído del carnet es dato personal.
 * @system compara el cliente del intento con el del token; los roles internos no tienen esa restricción.
 */
import type { AuthenticatedUser } from '../../common/types/auth.types.js';

export function esAjeno(duenoId: string | number | null | undefined, currentUser?: AuthenticatedUser): boolean {
  return currentUser?.role === 'customer' && String(duenoId ?? '') !== String(currentUser.customerId ?? '-');
}
