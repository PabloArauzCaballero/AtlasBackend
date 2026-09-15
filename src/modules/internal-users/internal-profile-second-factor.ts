/**
 * @file Tipos de dominio: hacen explícitos estados y contratos internos.
 * @business Esta pieza evita afirmar que una cuenta está protegida por un factor que su acceso no exige.
 * @system compone el perfil interno con el estado efectivo del segundo factor.
 */
import { InternalAccessProfile } from './internal-users.types.js';

/**
 * `mfaEnabled` de un usuario interno se INFORMA, no se lee de su ficha.
 *
 * La columna `iam.internal_users.mfa_enabled` existe desde el principio y no la escribe ningún
 * camino de código: el único endpoint que activa MFA (`POST /auth/mfa`) es el opt-in de `customer`
 * y toca `iam.auth_credentials`. Así que para toda cuenta interna vale `false`, y quien la leyera
 * concluía «esta cuenta no tiene segundo factor» incluso cuando su login exigía el PIN por correo
 * — y remitía a activarlo en el proveedor de identidad, donde no hay nada que activar.
 *
 * Lo que se publica es el estado EFECTIVO: para un interno el segundo factor es obligatorio y sólo
 * la configuración del despliegue (canal de correo, `AUTH_LOGIN_PIN_ENABLED`) puede quitarlo. El
 * nombre del campo describe eso —si el acceso lleva un factor más que la contraseña—, y así dice
 * la verdad.
 */
export function withEffectiveSecondFactor<T extends InternalAccessProfile>(profile: T, inEffect: boolean): T {
  return { ...profile, user: { ...profile.user, mfaEnabled: inEffect } };
}
