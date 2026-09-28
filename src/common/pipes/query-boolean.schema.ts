/**
 * @file Pipe: valida o transforma datos antes de invocar el controlador.
 * @business Esta pieza impide que un filtro `?x=false` se lea como `true` e invierta lo que ve un operador.
 * @system booleano estricto para parámetros de query (texto): sólo `true`, `false`, `1` y `0`.
 */
import { z } from 'zod';

const VERDADEROS = new Set(['true', '1']);
const FALSOS = new Set(['false', '0']);

/**
 * La coerción booleana de Zod es `Boolean(valor)`: cualquier texto no vacío —`"false"` y `"0"` incluidos—
 * sale `true`. En una query eso invertía el filtro sin error (`?assignedToMe=false` traía sólo los
 * casos del actor). Aquí sólo se aceptan las cuatro formas inequívocas; todo lo demás (`yes`, `""`,
 * `FALSO`, un valor repetido) llega crudo a `z.boolean()` y falla con 400, en vez de adivinarse.
 */
function parseQueryBoolean(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  const normalized = value.trim().toLowerCase();
  if (VERDADEROS.has(normalized)) return true;
  if (FALSOS.has(normalized)) return false;
  return value;
}

/** Booleano de query string. Se compone con `.optional()` o `.default(...)` en cada esquema. */
export const queryBooleanSchema = z.preprocess(parseQueryBoolean, z.boolean());
