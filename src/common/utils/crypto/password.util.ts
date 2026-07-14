import { randomInt } from 'node:crypto';
import argon2 from 'argon2';

/**
 * Hashing de contraseñas con Argon2id, conforme a BACKEND_DEVELOPMENT_CONTEXT.md §10
 * ("Contraseñas con Argon2id o bcrypt con coste apropiado").
 *
 * Si por alguna razón el equipo prefiere bcrypt en vez de argon2, esta es la ÚNICA capa que
 * hay que tocar: ningún otro módulo importa `argon2` directamente.
 */

const ARGON2_OPTIONS: argon2.Options = {
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

// Sin caracteres ambiguos (0/O, 1/l/I) porque esta contraseña se transcribe desde un correo.
const TEMPORARY_PASSWORD_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
const TEMPORARY_PASSWORD_LENGTH = 12;

/**
 * Contraseña por defecto para usuarios internos recién creados cuando el administrador no
 * define una explícitamente. Se entrega por correo (MailSender) y obliga a cambiarla en el
 * primer login (`mustChangePassword`).
 */
export function generateTemporaryPassword(): string {
  let candidate = '';
  do {
    candidate = Array.from(
      { length: TEMPORARY_PASSWORD_LENGTH },
      () => TEMPORARY_PASSWORD_ALPHABET[randomInt(0, TEMPORARY_PASSWORD_ALPHABET.length)],
    ).join('');
  } while (!isPasswordStrongEnough(candidate));
  return candidate;
}
