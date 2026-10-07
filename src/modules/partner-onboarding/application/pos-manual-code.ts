/**
 * @file Código manual de una caja: el que se teclea cuando la cámara no lee el QR.
 * @business Cada caja imprime, debajo de su QR, un código corto que el cliente puede dictar o escribir en la app.
 * @system genera, normaliza y da formato a códigos de 8 caracteres sin letras que se confunden entre sí.
 */
import { randomInt } from 'node:crypto';

/**
 * Sin 0/O, 1/I/L ni U/V: un código que se dicta en un mostrador ruidoso o se lee de un cartel
 * gastado no puede depender de distinguir «O» de «0». Con 29 símbolos y 8 posiciones hay ~5·10¹¹
 * combinaciones: adivinar la caja de otro comercio a ciegas no es práctico, y aun acertando
 * `merchant-qr/resolve` sólo devuelve nombre y rubro.
 */
export const POS_MANUAL_CODE_ALPHABET = '23456789ABCDEFGHJKMNPQRSTWXYZ';
export const POS_MANUAL_CODE_LENGTH = 8;

const VALID = new RegExp(`^[${POS_MANUAL_CODE_ALPHABET}]{${POS_MANUAL_CODE_LENGTH}}$`);

/** Un código nuevo, al azar criptográfico: no se deriva del serial, que ya está impreso en el QR. */
export function generatePosManualCode(): string {
  let code = '';
  for (let i = 0; i < POS_MANUAL_CODE_LENGTH; i += 1) code += POS_MANUAL_CODE_ALPHABET[randomInt(POS_MANUAL_CODE_ALPHABET.length)];
  return code;
}

/**
 * Lo que alguien escribió, llevado a la forma guardada: sin espacios ni guiones y en mayúsculas.
 * Devuelve `null` si no puede ser un código de caja (largo distinto o símbolos fuera del alfabeto).
 */
export function normalizePosManualCode(input: string): string | null {
  const compact = input.toUpperCase().replace(/[\s-]/g, '');
  return VALID.test(compact) ? compact : null;
}

/** `K7M29QXD` → `K7M2-9QXD`: se lee en dos mitades, como se dicta. */
export function formatPosManualCode(code: string): string {
  return `${code.slice(0, 4)}-${code.slice(4)}`;
}
