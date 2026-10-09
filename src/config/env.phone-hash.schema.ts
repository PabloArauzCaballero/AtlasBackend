/**
 * @file La clave con la que se guardan los teléfonos para poder cruzarlos (APP-21), en su propio módulo.
 * @business Un teléfono boliviano tiene unos 2·10⁷ valores: su SHA-256 desnudo se revierte en segundos, así que sin clave es PII en claro.
 * @system declara `PHONE_HASH_HMAC_KEYS`, valida su formato y la exige en producción.
 */
import { z } from 'zod';

/**
 * `<versión>:<secreto>` separados por comas, p. ej. `1:3f9a…` o, durante una rotación, `1:3f9a…,2:b07c…`.
 *
 * Por qué una LISTA y no una sola clave: el valor guardado no se puede volver a calcular desde cero al rotar —el
 * teléfono en claro no está en la base, que es justamente el objetivo—, así que rotar ENVUELVE el valor de la versión
 * anterior con la clave nueva (`v2 = HMAC(K2, v1)`). Para calcular hoy la huella de un teléfono hacen falta todas las
 * claves de la cadena, de la 1 a la vigente. Ver `phone-hash.util.ts` y `docs/runbooks/rotacion-de-claves.md`.
 */
export const PHONE_HASH_KEY_ENTRY = /^([1-9]\d{0,2}):(\S{32,})$/u;

export const phoneHashEnvShape = {
  PHONE_HASH_HMAC_KEYS: z.preprocess((value) => {
    if (typeof value === 'string' && value.trim() === '') return undefined;
    return value;
  }, z.string().optional()),
} as const;

/** Mensaje de por qué la lista no sirve, o `null` si sirve. Compartido con el util para no validar dos veces distinto. */
export function phoneHashKeysProblem(raw: string): string | null {
  const entries = raw
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
  if (entries.length === 0) return 'PHONE_HASH_HMAC_KEYS está vacía.';
  const versions: number[] = [];
  for (const entry of entries) {
    const match = PHONE_HASH_KEY_ENTRY.exec(entry);
    if (!match) return 'Cada entrada de PHONE_HASH_HMAC_KEYS debe ser «<versión>:<secreto de 32 o más caracteres>», sin espacios.';
    versions.push(Number(match[1]));
  }
  const sorted = [...versions].sort((a, b) => a - b);
  if (sorted.some((version, index) => version !== index + 1)) {
    return 'PHONE_HASH_HMAC_KEYS debe traer TODAS las versiones de la 1 a la vigente, sin huecos ni repetidas: cada rotación envuelve la anterior.';
  }
  return null;
}

/**
 * Obligatoria en producción. Fuera de ella el arranque no la exige —las pruebas y las herramientas que sólo leen el
 * entorno siguen funcionando—, pero cualquier operación que guarde o busque un teléfono falla con un error que la
 * nombra, y la migración que convierte los datos también: nunca se guarda un teléfono sin clave.
 */
export function checkPhoneHashKeys(
  data: { NODE_ENV: string; ATLAS_CAPABILITY_PROFILE?: string; PHONE_HASH_HMAC_KEYS?: string },
  ctx: z.RefinementCtx,
): void {
  const raw = data.PHONE_HASH_HMAC_KEYS;
  if (raw === undefined) {
    // El worker de Mensajería no guarda ni busca teléfonos de clientes (su rol de base ni ve `customer`).
    if (data.NODE_ENV === 'production' && data.ATLAS_CAPABILITY_PROFILE !== 'messaging') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['PHONE_HASH_HMAC_KEYS'],
        message: 'PHONE_HASH_HMAC_KEYS es obligatoria en producción (p. ej. «1:<openssl rand -hex 32>»).',
      });
    }
    return;
  }
  const problem = phoneHashKeysProblem(raw);
  if (problem) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['PHONE_HASH_HMAC_KEYS'], message: problem });
}
