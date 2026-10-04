/**
 * @file Utilidad pura o acotada reutilizable dentro de su capa.
 * @business Esta pieza aplica controles coherentes a todos los dominios y reduce fallas repetidas entre equipos.
 * @system provee infraestructura transversal de crypto sin introducir reglas de un dominio específico.
 */
import { createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import { env } from '../../../config/env.js';

/**
 * Códigos de un solo uso entregados por correo (reset de contraseña, PIN de login de
 * administradores). Igual que los refresh tokens, solo se persiste el hash SHA-256; el valor en
 * claro viaja una única vez en el correo y nunca puede reconstruirse desde la base de datos.
 */

export function generateNumericCode(length = 6): string {
  let code = '';
  for (let index = 0; index < length; index += 1) {
    code += String(randomInt(0, 10));
  }
  return code;
}

/** Token opaco de desafío para el segundo paso del login con PIN (misma entropía que un refresh token). */
export function generateChallengeToken(): string {
  return randomBytes(48).toString('base64url');
}

const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');

/**
 * La huella con la que se guarda un código (o un token de desafío).
 *
 * Con `AUTH_ONE_TIME_CODE_PEPPER` es un HMAC-SHA256: sin la pimienta —que vive en el entorno, no en la base— la
 * huella de un código de 6 dígitos no se puede revertir probando el millón. Sin pimienta es el SHA-256 de siempre.
 * Las dos son deterministas y de 64 hexadecimales: las búsquedas por `challengeHash` siguen funcionando y no cambia
 * ninguna columna.
 */
export function hashOneTimeCode(value: string): string {
  const pepper = env.AUTH_ONE_TIME_CODE_PEPPER;
  return pepper ? createHmac('sha256', pepper).update(value).digest('hex') : sha256(value);
}

function iguales(a: string, b: string): boolean {
  const izquierda = Buffer.from(a, 'hex');
  const derecha = Buffer.from(b, 'hex');
  return izquierda.length === derecha.length && timingSafeEqual(izquierda, derecha);
}

/**
 * Comprueba un código contra su huella guardada.
 *
 * Acepta también la huella SIN pimienta: es lo que tienen los códigos emitidos antes de configurarla, que viven
 * unos diez minutos. No abre nada a quien lea la base: una fila nueva guarda el HMAC, y acertar su SHA-256 exige
 * conocer el código igual que antes.
 */
export function verifyOneTimeCode(candidate: string, storedHash: string): boolean {
  const conPimienta = iguales(hashOneTimeCode(candidate), storedHash);
  const sinPimienta = iguales(sha256(candidate), storedHash);
  return conPimienta || sinPimienta;
}
