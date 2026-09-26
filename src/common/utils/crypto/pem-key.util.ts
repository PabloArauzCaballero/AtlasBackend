/**
 * @file Utilidad pura o acotada reutilizable dentro de su capa.
 * @business Una clave privada pegada en un panel de variables tiene que servir tal cual se pegó: si no,
 *   el push a Android o a iPhone falla en cada envío y nadie lo nota hasta que un cliente no recibe nada.
 * @system Normaliza una clave PEM que llega por variable de entorno a su forma con saltos de línea reales.
 */

/**
 * Deja una clave PEM con saltos de línea reales, venga como venga pegada.
 *
 * Medido el 2026-09-15 en el entorno de test: `FCM_PRIVATE_KEY` llegaba con los saltos escapados DOS
 * veces (`\\n`). La normalización anterior sólo quitaba un nivel (`\n` → salto), así que dejaba una
 * barra delante de cada línea, `createPrivateKey` respondía `DECODER routines::unsupported` y cada push
 * a Android habría fallado — sin que nadie lo viera, porque desde que se activó FCM no se había
 * intentado ninguno.
 *
 * Tolera las formas en que un panel (Coolify, un `.env`, un gestor de secretos) suele entregar la clave:
 * con saltos reales, escapados una o varias veces, envuelta en comillas y con finales de línea CRLF.
 * El cuerpo base64 de una PEM nunca contiene `\`, así que colapsar «barras + n» no puede tocarlo.
 */
export function normalizePemKey(raw: string): string {
  let key = raw.trim();
  const quoted = (key.startsWith('"') && key.endsWith('"')) || (key.startsWith("'") && key.endsWith("'"));
  if (quoted && key.length >= 2) key = key.slice(1, -1);
  return key.replace(/\\+n/g, '\n').replace(/\r\n?/g, '\n');
}
