/**
 * @file Tipos de dominio: hacen explícitos estados y contratos internos.
 * @business Esta pieza deja claro a qué producto se está entrando cuando llega un código por correo.
 * @system resuelve el nombre del producto que origina un correo a partir de la cabecera de la petición.
 */

/**
 * Los tres portales que piden códigos a este backend, con el nombre que verá quien reciba el correo.
 *
 * La cabecera del correo llevaba «Plataforma de decisiones» fija, así que un PIN pedido desde el
 * ERP llegaba con el nombre del motor. Quien recibe un código necesita saber a QUÉ está entrando:
 * es lo que separa «este acceso es mío» de «alguien está entrando a un portal que yo no he
 * abierto», y sin ese dato el correo no permite distinguirlos.
 */
export const ATLAS_PRODUCTS = {
  'decision-engine': 'Plataforma de decisiones',
  erp: 'ERP corporativo',
  'admin-portal': 'Portal interno',
} as const;

export type AtlasProductCode = keyof typeof ATLAS_PRODUCTS;

/**
 * Traduce la cabecera `x-atlas-product` al nombre del producto.
 *
 * Se resuelve contra una lista CERRADA y no se refleja lo que llegue: el valor acaba impreso en un
 * correo que sale con la marca de ATLAS, así que un texto libre desde el cliente sería una vía para
 * escribir en él. Un código desconocido —o ausente— cae a `undefined`, y la cabecera usa entonces
 * un rótulo genérico que es cierto para los tres.
 */
export function resolveProductName(code: string | undefined): string | undefined {
  if (!code) return undefined;
  const normalizado = code.trim().toLowerCase();
  return (ATLAS_PRODUCTS as Record<string, string | undefined>)[normalizado];
}
