import jpeg from 'jpeg-js';
import { PNG } from 'pngjs';

/**
 * Imágenes de prueba para la regla «lo que se sube como QR tiene que llevar un QR».
 *
 * Vive en `test/support` porque la usan dos baterías: la del lector de imágenes y la del servicio
 * que registra el QR del comercio. Duplicar el fixture dejaría que una de las dos siguiera pasando
 * con un QR que la otra ya no acepta.
 */

/**
 * Un QR de verdad, generado con el mismo generador que usa el portal (`lib/qr.ts` del ERP) y
 * comprobado con el lector antes de fijarlo aquí. Dice «atlas-qr-de-prueba».
 */
const QR_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAMYAAADGCAYAAACJm/9dAAAEgUlEQVR4Ae3BUQ7jVhIEwawG73/l2vk1+q0BGiQk2RmR/oGk' +
  'vxgkLYOkZZC0DJKWQdIySFoGScsgaRkkLYOkZZC0DJKWQdIySFoGScsgaRkkLYOkZZC0DJKWQdIySFoGScvFy5LwC9pykoQn' +
  'tOUkCZ/QlpMk/IK2vGmQtAySlkHSMkhaBknLxYe05ROScEdbTpLwhLacJOGOtrypLZ+QhE8YJC2DpGWQtAySlkHScvFlkvCE' +
  'tnxCW57QlpMk3JGEk7Y8IQlPaMs3GSQtg6RlkLQMkpZB0nKhf6QtJ0m4oy13tOUkCXrOIGkZJC2DpGWQtAySlgv9rSSctOWk' +
  'LXck4aQtJ0nQ+wZJyyBpGSQtg6RlkLRcfJm2fJO2nCThpC1vassdSXhTW/6NBknLIGkZJC2DpGWQtFx8SBJ+QRJO2nKShJO2' +
  'PCEJJ215UxL+SwZJyyBpGSQtg6RlkLSkf6DXJeGkLSdJOGnLSRJO2qL7BknLIGkZJC2DpGWQtFy8LAknbbkjCb+sLW9qyx1J' +
  '+IS23JGEk7a8aZC0DJKWQdIySFoGSUv6B18kCU9oyxOS8Ka2nCThTW15QhKe0JZvMkhaBknLIGkZJC2DpOXiZUk4acubknBH' +
  'W07a8oQk3NGWO5Jw0pYnJOGkLSdJ+GWDpGWQtAySlkHSMkhaLj4kCSdtOUnCHW25Iwm/IAlPSMJJW+5IwklbTpJwkoSTtnzC' +
  'IGkZJC2DpGWQtAySlosPacsnJOGkLXck4U1JuKMtJ0m4Iwl3tOVNSThpy5sGScsgaRkkLYOkZZC0pH/woiQ8oS1vSsKb2nKS' +
  'hJO23JGEO9pyRxLuaMsdSThpyycMkpZB0jJIWgZJyyBpuXhZW56QhJO2nCThCW05ScJJW06ScEcSvklbTpJwRxJO2vJNBknL' +
  'IGkZJC2DpGWQtFx8mSTckYSTtjwhCW9qy0kSTtpyRxLe1JZ/o0HSMkhaBknLIGkZJC0XL0vCm9pyRxLuaMsdSThpy0kSPiEJ' +
  'vyAJJ2150yBpGSQtg6RlkLQMkpb0D/R/JeEJbbkjCW9qyxOScNKWXzZIWgZJyyBpGSQtg6Tl4mVJ+AVteUJbntCWJyThjiSc' +
  'tOW/ZJC0DJKWQdIySFoGScvFh7TlE5JwR1velISTtpwk4aQtT2jLE5Lwpra8aZC0DJKWQdIySFoGScvFl0nCE9ryhCTc0ZaT' +
  'JJy05SQJb0rCm9pykoSTtpwk4RMGScsgaRkkLYOkZZC0XOhvteUkCXe05SQJJ215QlvuSMJJW+5Iwh1J+CaDpGWQtAySlkHS' +
  'MkhaLvSPtOUkCU9IwjdJwklbTtpykoQ72vIJg6RlkLQMkpZB0jJIWi6+TFt+WVtOknDSlpMknLTlTUkQDJKWQdIySFoGScsg' +
  'abn4kCT8giQ8oS0nSXhCEk7acpKEJyThTUk4acubBknLIGkZJC2DpGWQtKR/IOkvBknLIGkZJC2DpGWQtAySlkHSMkhaBknL' +
  'IGkZJC2DpGWQtAySlkHSMkhaBknLIGkZJC2DpGWQtAySlkHS8j8yNmO3G7LdHAAAAABJRU5ErkJggg==';

export const CONTENIDO_QR_DE_PRUEBA = 'atlas-qr-de-prueba';

export function qrPng(): Buffer {
  return Buffer.from(QR_PNG_BASE64, 'base64');
}

/** El mismo código, en JPEG: es el otro formato que el expediente acepta. */
export function qrJpeg(): Buffer {
  const png = PNG.sync.read(qrPng());
  return Buffer.from(jpeg.encode({ data: png.data, width: png.width, height: png.height }, 92).data);
}

/** Una imagen que se ve perfecta y no lleva ningún código: el caso que se colaba. */
export function imagenSinQr(ancho = 240, alto = 240, gris = 210): Buffer {
  const png = new PNG({ width: ancho, height: alto });
  for (let i = 0; i < png.data.length; i += 4) {
    png.data[i] = gris;
    png.data[i + 1] = gris;
    png.data[i + 2] = gris;
    png.data[i + 3] = 255;
  }
  return PNG.sync.write(png);
}
