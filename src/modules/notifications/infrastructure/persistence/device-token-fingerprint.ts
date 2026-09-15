/**
 * @file La huella con la que se localiza un token de dispositivo en `device_tokens`.
 * @business Permite reconocer el mismo teléfono entre avisos sin guardar nunca su token en claro.
 * @system Vive sola y la usan LOS DOS lados —el registro que la escribe y la baja que la busca—
 *   precisamente para que no puedan divergir.
 *
 * Si cada lado calculara la suya, el día que una cambiara la baja dejaría de encontrar filas y no
 * fallaría nada: la entrega seguiría diciendo «desactivados 0» y los tokens muertos se reintentarían
 * para siempre. Es la clase de avería que no levanta ninguna alarma, así que se impide por
 * construcción en vez de vigilarla con una prueba.
 */
import { sha256Hex } from '../../../../common/utils/crypto/hash.util.js';
import { stableStringify } from '../../../../common/utils/privacy/redaction.util.js';

export function deviceTokenFingerprint(token: string): string {
  return sha256Hex(stableStringify({ token }));
}
