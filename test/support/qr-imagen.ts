/**
 * Imágenes de prueba para la regla «lo que se sube como QR tiene que llevar un QR».
 *
 * El fixture REAL vive en `scripts/fixtures/qr-imagen.ts` y aquí sólo se reexporta. El motivo es la
 * imagen de Docker: copia `src/` y `scripts/`, pero NO `test/`, así que un smoke que importara desde
 * aquí compila en el anfitrión y rompe la construcción del contenedor con «Cannot find module».
 *
 * Se reexporta en vez de mover el import de las dos baterías porque el sitio natural para buscarlo,
 * desde una prueba, sigue siendo `test/support`. Y duplicarlo dejaría que el smoke pasara con un QR
 * que las pruebas ya no aceptan, que es justo lo que este archivo existe para impedir.
 */
export { CONTENIDO_QR_DE_PRUEBA, imagenSinQr, qrJpeg, qrPng } from '../../scripts/fixtures/qr-imagen.js';
