/**
 * @file Utilidad transversal: normaliza un teléfono antes de hashearlo.
 * @business Esta pieza hace que dos escrituras del mismo número produzcan el mismo hash y el cruce encuentre algo.
 * @system replica la regla de normalización de la app móvil (`features/agenda.ts`) en el servidor.
 */

/**
 * Sólo dígitos, y NACIONALES.
 *
 * ## Por qué existe una copia de esto en el servidor
 *
 * Porque los hashes que se comparan vienen de dos sitios. La app calcula hashes de la agenda con su
 * propia normalización (`features/agenda.ts`), y el servidor calcula los de las referencias
 * declaradas y los de la agenda que recibe sin normalizar. Si las dos reglas divergen, el cruce no
 * encuentra NUNCA nada: la señal queda muerta, sale cero en vez de error, y nada lo delata.
 *
 * Las dos implementaciones tienen que decir lo mismo, y por eso ésta lleva su prueba al lado y la de
 * la app también. Es la clase de duplicación que se acepta a cambio de no compartir un paquete entre
 * un backend de Nest y un binario de Expo.
 *
 * ## La guarda del prefijo
 *
 * Se quita el `591` de delante sólo si al quitarlo queda algo con forma de teléfono. `5915678` son
 * siete dígitos: recortarlos dejaría `5678`, que no es un número. Sin esa guarda, un fijo que empiece
 * por 591 se convertiría en otro distinto y su hash dejaría de cruzar con el de su propia referencia.
 */
export function normalizePhoneForHash(value: string | null | undefined): string | null {
  if (!value) return null;
  const digits = value.replace(/\D/gu, '');
  if (digits.length < 7) return null;
  return digits.startsWith('591') && digits.length > 8 ? digits.slice(3) : digits;
}

/** Un correo comparable: recortado y en minúsculas. Nada más — no se tocan alias ni puntos. */
export function normalizeEmailForHash(value: string | null | undefined): string | null {
  if (!value) return null;
  const normalized = value.trim().toLowerCase();
  return normalized.includes('@') ? normalized : null;
}
