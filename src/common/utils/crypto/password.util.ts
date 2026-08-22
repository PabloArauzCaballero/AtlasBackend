/**
 * @file Utilidad pura o acotada reutilizable dentro de su capa.
 * @business Esta pieza aplica controles coherentes a todos los dominios y reduce fallas repetidas entre equipos.
 * @system provee infraestructura transversal de crypto sin introducir reglas de un dominio específico.
 */
import { randomInt } from 'node:crypto';
import argon2 from 'argon2';

/**
 * Hashing de contraseñas con Argon2id, conforme a BACKEND_DEVELOPMENT_CONTEXT.md §10
 * ("Contraseñas con Argon2id o bcrypt con coste apropiado").
 *
 * Si por alguna razón el equipo prefiere bcrypt en vez de argon2, esta es la ÚNICA capa que
 * hay que tocar: ningún otro módulo importa `argon2` directamente.
 */

const ARGON2_OPTIONS: argon2.HashOptions = {
  type: argon2.argon2id,
  memoryCost: 19456, // ~19 MB, recomendación OWASP 2023 para argon2id interactivo
  timeCost: 2,
  parallelism: 1,
};

export async function hashPassword(plainTextPassword: string): Promise<string> {
  return argon2.hash(plainTextPassword, ARGON2_OPTIONS);
}

export async function verifyPassword(hash: string, plainTextPassword: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, plainTextPassword);
  } catch {
    // argon2.verify lanza si el hash tiene un formato inválido/corrupto; tratarlo como
    // "no coincide" en vez de dejar que la excepción se propague como error 500.
    return false;
  }
}

const PASSWORD_MIN_LENGTH = 10;

export function isPasswordStrongEnough(plainTextPassword: string): boolean {
  if (plainTextPassword.length < PASSWORD_MIN_LENGTH) return false;
  const hasLetter = /[a-zA-Z]/.test(plainTextPassword);
  const hasDigitOrSymbol = /[0-9\W]/.test(plainTextPassword);
  return hasLetter && hasDigitOrSymbol;
}

/** Longitud del PIN del cliente. Cuatro dígitos es lo que la gente recuerda sin apuntarlo. */
export const CUSTOMER_PIN_LENGTH = 4;

/**
 * Los PIN que no se aceptan aunque tengan cuatro dígitos.
 *
 * Con 10.000 combinaciones, la defensa no puede ser solo el bloqueo por intentos: unos pocos PIN
 * concentran una parte enorme de las elecciones reales. `1234` por sí solo ronda el 10% de los PIN
 * de cuatro dígitos que la gente elige. Prohibir esta lista corta —repetidos, secuencias y los
 * cuatro más usados— quita justo los que probaría cualquiera antes de rendirse.
 *
 * También se rechazan los años recientes, que es la otra elección predecible: la fecha de
 * nacimiento del titular o la de su hijo.
 */
const BANNED_PINS = new Set([
  '0000', '1111', '2222', '3333', '4444', '5555', '6666', '7777', '8888', '9999',
  '1234', '2345', '3456', '4567', '5678', '6789', '7890',
  '4321', '5432', '6543', '7654', '8765', '9876', '0987',
  '1212', '1122', '1004', '2000', '6969', '1313', '2001', '1010',
]);

/**
 * Un PIN de cliente: cuatro dígitos, y no uno de los adivinables.
 *
 * ## Por qué un PIN y no una contraseña
 *
 * Porque la contraseña de diez caracteres la olvidaba la mitad de la gente y la recuperación pasa
 * por el correo — que en este segmento no siempre se revisa. Un PIN que se recuerda es un PIN que
 * no se apunta en un papel, y ésa era la alternativa real.
 *
 * ## Qué lo sostiene
 *
 * El PIN NO es la única defensa. Encima corren el bloqueo temporal por intentos fallidos
 * (`AUTH_MAX_FAILED_LOGIN_ATTEMPTS`) y la lista de arriba. Sigue siendo más débil que una
 * contraseña larga: es una decisión de producto tomada con eso sabido, no un descuido.
 *
 * Solo aplica al CLIENTE. Los usuarios internos y los del comercio conservan
 * `isPasswordStrongEnough`: un PIN de cuatro dígitos en el portal que aprueba créditos sería
 * indefendible.
 */
export function isCustomerPinValid(candidate: string): boolean {
  // Literal y no plantilla: una expresion regular construida con texto se lee peor y aqui no gana nada.
  if (!/^\d{4}$/.test(candidate)) return false;
  return !BANNED_PINS.has(candidate);
}

// Sin caracteres ambiguos (0/O, 1/l/I) porque esta contraseña se transcribe desde un correo.
const TEMPORARY_PASSWORD_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
const TEMPORARY_PASSWORD_LENGTH = 12;

/**
 * Contraseña por defecto para usuarios internos recién creados cuando el administrador no
 * define una explícitamente. Se entrega por correo (MailSender) y obliga a cambiarla en el
 * primer login (`mustChangePassword`).
 */
export function generateTemporaryPassword(): string {
  let candidate: string;
  do {
    candidate = Array.from(
      { length: TEMPORARY_PASSWORD_LENGTH },
      () => TEMPORARY_PASSWORD_ALPHABET[randomInt(0, TEMPORARY_PASSWORD_ALPHABET.length)],
    ).join('');
  } while (!isPasswordStrongEnough(candidate));
  return candidate;
}

/**
 * La regla de secreto que le toca a cada poblacion.
 *
 * El cliente usa un PIN de cuatro digitos; los internos y los del comercio, una contrasena larga.
 * Se resuelve en un solo sitio para que cambiar la contrasena, restablecerla y darse de alta no
 * puedan aplicar reglas distintas al mismo actor —que es como acaba una cuenta con un PIN que su
 * propio flujo de recuperacion no acepta.
 */
export function isSecretValidFor(actorType: string, secret: string): boolean {
  return actorType === 'customer' ? isCustomerPinValid(secret) : isPasswordStrongEnough(secret);
}

/** El mensaje que corresponde a la regla que se incumplio. */
export function secretRequirementMessage(actorType: string): string {
  return actorType === 'customer'
    ? 'Tu PIN debe ser de 4 digitos y no puede ser uno facil de adivinar.'
    : 'La contrasena no cumple el minimo de seguridad requerido.';
}
