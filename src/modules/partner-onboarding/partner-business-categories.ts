/**
 * El rubro del comercio, catalogado.
 *
 * Antes era texto libre (`z.string().min(2).max(80)`) y el resultado estaba a la vista en la base:
 * el mismo rubro guardado como `retail`, `RETAIL` y `EDUCATION` a la vez. No es un problema
 * cosmético. `LoanSpendingService` agrupa el gasto del cliente POR ESTE VALOR, asi que `retail` y
 * `RETAIL` producen dos rubros distintos en el mismo informe, cada uno con la mitad del gasto real;
 * y las reglas de comisión que segmentan por categoría dejan de encajar en cuanto alguien escribe
 * el rubro con otra caja.
 *
 * Un catálogo cerrado quita esa clase de fallo de raíz: lo que no está en la lista se rechaza en el
 * borde, y todo lo que entra ya está normalizado.
 */
export const PARTNER_BUSINESS_CATEGORIES = [
  'RETAIL',
  'SERVICIOS',
  'EDUCACION',
  'SALUD',
  'ALIMENTOS',
  'TECNOLOGIA',
  'HOGAR',
  'VESTIMENTA',
  'AUTOMOTOR',
  'CONSTRUCCION',
  'TURISMO',
  'OTRO',
] as const;

export type PartnerBusinessCategory = (typeof PARTNER_BUSINESS_CATEGORIES)[number];

/**
 * Sinónimos aceptados al normalizar, para no rechazar lo que ya existe.
 *
 * Sólo cubre lo que de verdad se escribió alguna vez —el inglés que trajeron las semillas de
 * desarrollo—. No es una lista de traducción general: cada entrada existe porque hay o hubo una
 * fila con ese valor, y añadir sinónimos «por si acaso» reabriría justo la puerta que esto cierra.
 */
const SINONIMOS: Readonly<Record<string, PartnerBusinessCategory>> = {
  EDUCATION: 'EDUCACION',
  SERVICES: 'SERVICIOS',
  HEALTH: 'SALUD',
  FOOD: 'ALIMENTOS',
  TECHNOLOGY: 'TECNOLOGIA',
  HOME: 'HOGAR',
  APPAREL: 'VESTIMENTA',
  CLOTHING: 'VESTIMENTA',
  AUTOMOTIVE: 'AUTOMOTOR',
  CONSTRUCTION: 'CONSTRUCCION',
  TOURISM: 'TURISMO',
  OTHER: 'OTRO',
};

/**
 * Lleva un rubro escrito de cualquier manera a su forma canónica, o devuelve `null` si no es
 * ninguno de los del catálogo.
 *
 * Devolver `null` en vez de caer en `OTRO` es deliberado: `OTRO` es una respuesta que alguien
 * eligió, y convertir en `OTRO` lo que no se entiende hace indistinguible «este negocio es de otro
 * rubro» de «aquí hay un dato roto que nadie revisó».
 */
export function normalizeBusinessCategory(value: string): PartnerBusinessCategory | null {
  const upper = value.trim().toUpperCase();
  if ((PARTNER_BUSINESS_CATEGORIES as readonly string[]).includes(upper)) {
    return upper as PartnerBusinessCategory;
  }
  return SINONIMOS[upper] ?? null;
}
