/**
 * @file Puerto de salida: lo que este módulo necesita de otro, sin depender de su implementación.
 * @business Cambiar la cuenta de cobro de un comercio exige repetir la contraseña: una sesión robada ya no basta para desviar sus cobros.
 * @system la verificación de la prueba la inyecta el módulo (hoy `AuthReauthenticationService`); aquí sólo se declara la forma.
 */

/** Token de inyección: el módulo lo resuelve con `useExisting: AuthReauthenticationService`. */
export const PAYMENT_QR_REAUTH = Symbol('PAYMENT_QR_REAUTH');

/**
 * Cabecera con la que viaja la prueba. Es la misma que declara `auth` (`REAUTH_TOKEN_HEADER`); se
 * repite aquí porque las fronteras de módulos (`check:architecture`) no dejan que
 * `partner-onboarding` importe de `auth`.
 */
export const PAYMENT_QR_REAUTH_HEADER = 'x-reauth-token';

type ProofInput = { actorType: 'merchant_user'; actorId: string; reauthToken: string | null | undefined };

/**
 * Subconjunto estructural de `AuthReauthenticationService`. Las dos operaciones responden 403
 * `REAUTH_REQUIRED` si la prueba falta, es de otro usuario, venció o ya se usó.
 */
export interface PaymentQrReauth {
  /** Comprueba sin gastar: para fallar antes del trabajo caro. */
  assertValid(input: ProofInput): Promise<void>;
  /** Gasta la prueba: un solo uso, también bajo concurrencia. */
  consume(input: ProofInput): Promise<void>;
}
