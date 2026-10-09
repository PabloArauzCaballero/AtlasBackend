/**
 * @file La huella con la que se guarda y se busca un teléfono: HMAC con clave del servidor sobre su SHA-256 (APP-21).
 * @business Un SHA-256 de un móvil boliviano se revierte probando los ~2·10⁷ números posibles; sin la clave del servidor, la huella no.
 * @system única puerta de escritura y de búsqueda de las columnas de teléfono; versiona la clave en el propio valor para poder rotarla.
 */
import { createHmac } from 'node:crypto';
import { env } from '../../../config/env.js';
import { PHONE_HASH_KEY_ENTRY, phoneHashKeysProblem } from '../../../config/env.phone-hash.schema.js';
import { hashSensitiveText } from './hash.util.js';

/**
 * Formato guardado: `ph<versión>:<64 hex>`.
 *
 * - `ph1:` = `HMAC-SHA256(K1, sha256(trim+lower(teléfono)))`.
 * - `phN:` = `HMAC-SHA256(KN, <hex de la versión N-1>)`. Rotar ENVUELVE: no hace falta el teléfono en claro, que
 *   no está en la base. Por eso la variable trae todas las claves de la cadena.
 *
 * El prefijo es lo que hace idempotente la conversión (un valor ya convertido no se vuelve a envolver) y lo que dice
 * a una rotación qué filas faltan. Cabe sobrado en las columnas `VARCHAR(128)`.
 */
const STORED = /^ph([1-9]\d{0,2}):([0-9a-f]{64})$/u;
const PREFIXED = /^ph\d+:/u;

type PhoneHashKey = { version: number; secret: string };

let cache: { raw: string; keys: PhoneHashKey[] } | null = null;

/** Las claves de la cadena, de la 1 a la vigente. Sin ellas no se guarda ni se busca un teléfono: nunca hay retroceso a SHA-256. */
function chain(): PhoneHashKey[] {
  const raw = env.PHONE_HASH_HMAC_KEYS?.trim();
  if (!raw) {
    throw new Error('PHONE_HASH_HMAC_KEYS no está configurada: no se puede guardar ni buscar un teléfono sin la clave del servidor.');
  }
  if (cache?.raw === raw) return cache.keys;
  const problem = phoneHashKeysProblem(raw);
  if (problem) throw new Error(problem);
  const keys = raw
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const [, version, secret] = PHONE_HASH_KEY_ENTRY.exec(entry) as RegExpExecArray;
      return { version: Number(version), secret: secret as string };
    })
    .sort((a, b) => a.version - b.version);
  cache = { raw, keys };
  return keys;
}

/** Versión con la que se escribe hoy. */
export function currentPhoneHashVersion(): number {
  return chain().length;
}

function hmacHex(secret: string, value: string): string {
  return createHmac('sha256', secret).update(value).digest('hex');
}

/** Envuelve `hex` (el valor de la versión `from`, sin prefijo; `from = 0` es el SHA-256) hasta la versión vigente. */
function wrapFrom(from: number, hex: string): string {
  const keys = chain();
  let value = hex;
  for (const key of keys.slice(from)) value = hmacHex(key.secret, value);
  return `ph${keys.length}:${value}`;
}

/**
 * LA función: la huella de un teléfono a partir de su SHA-256 normalizado (el que manda la app, o el de
 * `hashSensitiveText`). Toda escritura y toda búsqueda de una columna de teléfono pasa por aquí.
 *
 * Rechaza un valor que ya tiene el prefijo: envolver dos veces daría una huella que nadie puede volver a encontrar,
 * y el error de programación tiene que verse, no quedar como un cruce que da cero.
 */
export function phoneLookupHash(phoneSha256: string): string {
  const digest = phoneSha256.trim().toLowerCase();
  if (PREFIXED.test(digest)) throw new Error('phoneLookupHash recibió una huella ya protegida; compárala tal cual.');
  return wrapFrom(0, digest);
}

/** Atajo para cuando lo que se tiene es el teléfono escrito: misma normalización que el resto del sistema. */
export function phoneLookupHashFromPlain(phone: string): string {
  return phoneLookupHash(hashSensitiveText(phone));
}

/**
 * Lleva un valor GUARDADO a la versión vigente, sin el teléfono en claro. Para las migraciones que convierten o
 * rotan: un SHA-256 (o cualquier valor sin prefijo, como lo guardaba el código anterior) se trata como versión 0.
 * Devuelve `null` si ya está en la vigente. Falla si el valor dice una versión que la variable no conoce.
 */
export function upgradeStoredPhoneHash(stored: string): string | null {
  const match = STORED.exec(stored);
  if (!match) {
    if (PREFIXED.test(stored)) throw new Error('Huella de teléfono con prefijo y formato no reconocido.');
    return phoneLookupHash(stored);
  }
  const version = Number(match[1]);
  const current = currentPhoneHashVersion();
  if (version === current) return null;
  if (version > current) {
    throw new Error(`Huella de teléfono en la versión ${String(version)} y PHONE_HASH_HMAC_KEYS sólo llega a la ${String(current)}.`);
  }
  return wrapFrom(version, match[2] as string);
}
