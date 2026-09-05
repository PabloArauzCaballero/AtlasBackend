/**
 * @file Tipos de dominio: hacen explícitos estados y contratos internos.
 * @business Esta pieza protege el acceso de clientes y operadores, la recuperación de cuenta y la continuidad segura de sesiones.
 * @system resuelve actores, credenciales, JWT, códigos de un solo uso y rotación/revocación de refresh tokens.
 */

/** Las cuatro poblaciones autenticables del sistema. */
export type ActorType = 'customer' | 'internal_user' | 'platform_user' | 'merchant_user';

/**
 * Para qué se emitió un código de un solo uso. La columna es `varchar(40)`, no un enum de la base:
 * añadir un propósito es un cambio de tipo, no una migración.
 *
 * Vive aquí y no en `auth.repository.ts` porque ese archivo arrastra deuda de tamaño congelada y
 * cada propósito nuevo hacía que la unión pasara de 140 columnas, obligando a prettier a partirla
 * en varias líneas: el trinquete de tamaño rechazaba el crecimiento y la única salida era esta
 * extracción. Que el vocabulario tenga archivo propio además lo deja donde se puede leer entero.
 */
export type OneTimeCodePurpose =
  'password_reset' | 'password_change' | 'login_pin' | 'contact_verification_phone' | 'contact_verification_email';

/**
 * Qué se registra en la bitácora de autenticación (`auth_events.event_type`, `varchar(60)`).
 *
 * `password_reset` y `password_change` son eventos DISTINTOS a propósito: el primero lo dispara
 * quien no puede entrar, el segundo quien ya está dentro. Colapsarlos borraría la única señal que
 * distingue una recuperación de cuenta legítima de una toma de control con la sesión ya robada.
 */
export type AuthEventType =
  'login' | 'logout' | 'login_pin_challenge' | 'password_reset_request' | 'password_reset' | 'password_change_request' | 'password_change';

/** Una entrada de esa bitácora, tal como la escribe `AuthRepository.recordLoginAttemptEvent`. */
export type LoginAttemptEvent = {
  tenantId: string | null;
  actorType: ActorType;
  actorId: string | null;
  eventType: AuthEventType;
  successful: boolean;
  failureReasonCode: string | null;
  ipAddress: string | null;
  userAgent: string | null;
};
