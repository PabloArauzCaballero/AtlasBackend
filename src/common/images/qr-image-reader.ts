/**
 * @file Utilidad de dominio compartida: leer el código QR que contiene una imagen.
 * @business Un QR de cobro dice a qué cuenta va el dinero del cliente; una foto que no lleva ningún código no puede ocupar ese sitio.
 * @system decodifica PNG/JPEG a píxeles y busca un QR legible, con el trabajo acotado por tamaño.
 */
import jpeg from 'jpeg-js';
import jsQR from 'jsqr';
import { PNG } from 'pngjs';

/**
 * ¿Esta imagen contiene un código QR?
 *
 * Existe porque «es una imagen» no era suficiente. El registro del QR de un comercio comprobaba el
 * tipo, el tamaño y el hash del objeto subido —todo cierto y todo insuficiente—: una foto del local,
 * una captura de pantalla o un archivo en blanco pasaban igual, y el expediente quedaba afirmando
 * que ese comercio tiene QR de cobro cuando no lo tiene. El fallo aparecía recién en la caja, con el
 * cliente delante intentando escanear una fotografía.
 *
 * Devuelve el CONTENIDO del código cuando lo hay. Quien llama decide qué hacer con él; aquí no se
 * persiste nada: el contenido de un QR bancario es un número de cuenta.
 */

/** Píxeles por encima de los cuales se reduce antes de buscar. */
const PIXELES_PARA_BUSCAR = 2_000_000;
/** Tope absoluto: por encima de esto la imagen ni se intenta, se rechaza por tamaño. */
const PIXELES_MAXIMOS = 40_000_000;

export interface ImagenEnPixeles {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

export type MotivoIlegible = 'FORMATO_NO_SOPORTADO' | 'IMAGEN_CORRUPTA' | 'IMAGEN_DEMASIADO_GRANDE';

export type LecturaQr =
  | { ok: true; contenido: string }
  | { ok: false; motivo: 'SIN_CODIGO' | MotivoIlegible };

/** PNG o JPEG a RGBA. Cualquier otro formato no se adivina: se dice que no se soporta. */
function aPixeles(buffer: Buffer, contentType: string): ImagenEnPixeles | MotivoIlegible {
  const tipo = contentType.split(';')[0]?.trim().toLowerCase() ?? '';
  try {
    if (tipo === 'image/png') {
      const png = PNG.sync.read(buffer);
      return { data: new Uint8ClampedArray(png.data), width: png.width, height: png.height };
    }
    if (tipo === 'image/jpeg' || tipo === 'image/jpg') {
      // `maxMemoryUsageInMB` acota lo que una imagen hostil puede pedir al decodificarse: sin él,
      // un JPEG con dimensiones absurdas declaradas en la cabecera reserva memoria antes de que
      // nadie haya mirado un solo píxel.
      const imagen = jpeg.decode(buffer, { useTArray: true, maxMemoryUsageInMB: 256 });
      return { data: new Uint8ClampedArray(imagen.data), width: imagen.width, height: imagen.height };
    }
    return 'FORMATO_NO_SOPORTADO';
  } catch {
    return 'IMAGEN_CORRUPTA';
  }
}

/**
 * Reduce por un factor entero muestreando un píxel de cada bloque.
 *
 * Sin esto, la foto de 12 megapíxeles que saca un teléfono ocupa 48 MB en RGBA y hace trabajar al
 * detector varios segundos por cada intento — y hay dos intentos. Muestrear basta: un QR legible
 * sigue siéndolo a la mitad o a un tercio de resolución, que es justo lo que hace la cámara del
 * propio teléfono al enfocarlo.
 */
function reducir(imagen: ImagenEnPixeles, factor: number): ImagenEnPixeles {
  const width = Math.max(1, Math.floor(imagen.width / factor));
  const height = Math.max(1, Math.floor(imagen.height / factor));
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    const origenY = Math.min(imagen.height - 1, y * factor);
    for (let x = 0; x < width; x += 1) {
      const origenX = Math.min(imagen.width - 1, x * factor);
      const destino = (y * width + x) * 4;
      const origen = (origenY * imagen.width + origenX) * 4;
      data[destino] = imagen.data[origen] ?? 0;
      data[destino + 1] = imagen.data[origen + 1] ?? 0;
      data[destino + 2] = imagen.data[origen + 2] ?? 0;
      data[destino + 3] = imagen.data[origen + 3] ?? 255;
    }
  }
  return { data, width, height };
}

function buscar(imagen: ImagenEnPixeles): string | null {
  /*
   * `attemptBoth` prueba también con los colores invertidos.
   *
   * Los QR de la banca boliviana se imprimen a menudo en claro sobre fondo oscuro, y sin esto se
   * rechazarían códigos perfectamente válidos por el color del cartel.
   */
  const lectura = jsQR(imagen.data, imagen.width, imagen.height, { inversionAttempts: 'attemptBoth' });
  const contenido = lectura?.data?.trim();
  return contenido ? contenido : null;
}

export function leerQrDeImagen(buffer: Buffer, contentType: string): LecturaQr {
  const pixeles = aPixeles(buffer, contentType);
  if (typeof pixeles === 'string') return { ok: false, motivo: pixeles };

  const total = pixeles.width * pixeles.height;
  if (total === 0) return { ok: false, motivo: 'IMAGEN_CORRUPTA' };
  if (total > PIXELES_MAXIMOS) return { ok: false, motivo: 'IMAGEN_DEMASIADO_GRANDE' };

  const factor = total > PIXELES_PARA_BUSCAR ? Math.ceil(Math.sqrt(total / PIXELES_PARA_BUSCAR)) : 1;
  const reducida = factor > 1 ? reducir(pixeles, factor) : pixeles;

  const enReducida = buscar(reducida);
  if (enReducida) return { ok: true, contenido: enReducida };

  /*
   * Segundo intento a resolución completa, SÓLO si se redujo.
   *
   * Un QR pequeño dentro de una foto grande puede perder los módulos al muestrear. Cuesta un
   * segundo intento y evita rechazar por nuestra propia optimización algo que el usuario ve
   * perfectamente legible en su pantalla.
   */
  if (factor > 1) {
    const enOriginal = buscar(pixeles);
    if (enOriginal) return { ok: true, contenido: enOriginal };
  }

  return { ok: false, motivo: 'SIN_CODIGO' };
}
