/**
 * La imagen que se sube como QR tiene que llevar un QR.
 *
 * Es la regla que faltaba: el registro comprobaba tipo, tamaño y hash —todo cierto y todo
 * insuficiente— y aceptaba cualquier fotografía. Lo que se fija aquí es que un código legible pasa
 * y que lo que no lo es se rechaza DICIENDO por qué, porque el comercio tiene que saber si el
 * problema es su foto o el formato del archivo.
 */
import { PNG } from 'pngjs';
import { leerQrDeImagen } from '../../../src/common/images/qr-image-reader.js';
import { CONTENIDO_QR_DE_PRUEBA, imagenSinQr, qrJpeg, qrPng } from '../../support/qr-imagen.js';

/**
 * Un QR de verdad, generado con el mismo generador que usa el portal (`lib/qr.ts` del ERP) y
 * comprobado con el lector antes de fijarlo aquí. Dice «atlas-qr-de-prueba».
 */
describe('leerQrDeImagen', () => {
  it('lee el contenido de un QR legible', () => {
    const lectura = leerQrDeImagen(qrPng(), 'image/png');
    expect(lectura).toEqual({ ok: true, contenido: CONTENIDO_QR_DE_PRUEBA });
  });

  it('rechaza una imagen sin código, que es el caso que se colaba', () => {
    const lectura = leerQrDeImagen(imagenSinQr(), 'image/png');
    expect(lectura).toEqual({ ok: false, motivo: 'SIN_CODIGO' });
  });

  it('lee el mismo código en JPEG, que es el otro formato aceptado', () => {
    expect(leerQrDeImagen(qrJpeg(), 'image/jpeg')).toEqual({ ok: true, contenido: CONTENIDO_QR_DE_PRUEBA });
  });

  it('rechaza un archivo que no es una imagen del formato declarado', () => {
    const lectura = leerQrDeImagen(Buffer.from('esto no es un PNG'), 'image/png');
    expect(lectura).toEqual({ ok: false, motivo: 'IMAGEN_CORRUPTA' });
  });

  it('no adivina formatos que no sabe decodificar', () => {
    const lectura = leerQrDeImagen(qrPng(), 'image/gif');
    expect(lectura).toEqual({ ok: false, motivo: 'FORMATO_NO_SOPORTADO' });
  });

  it('el tipo puede venir con parámetros, como lo manda un navegador', () => {
    const lectura = leerQrDeImagen(qrPng(), 'image/png; charset=binary');
    expect(lectura.ok).toBe(true);
  });

  it('encuentra el código aunque la imagen venga grande y haya que reducirla', () => {
    // El QR pegado en una esquina de una imagen de 5 megapíxeles: la foto de un teléfono.
    const original = PNG.sync.read(qrPng());
    const grande = new PNG({ width: 2400, height: 2000 });
    for (let i = 0; i < grande.data.length; i += 4) {
      grande.data[i] = grande.data[i + 1] = grande.data[i + 2] = 255;
      grande.data[i + 3] = 255;
    }
    const escala = 4;
    for (let y = 0; y < original.height * escala; y += 1) {
      for (let x = 0; x < original.width * escala; x += 1) {
        const origen = (Math.floor(y / escala) * original.width + Math.floor(x / escala)) * 4;
        const destino = ((y + 100) * grande.width + (x + 100)) * 4;
        grande.data[destino] = original.data[origen] ?? 0;
        grande.data[destino + 1] = original.data[origen + 1] ?? 0;
        grande.data[destino + 2] = original.data[origen + 2] ?? 0;
        grande.data[destino + 3] = 255;
      }
    }
    const lectura = leerQrDeImagen(PNG.sync.write(grande), 'image/png');
    expect(lectura).toEqual({ ok: true, contenido: CONTENIDO_QR_DE_PRUEBA });
  });
});
