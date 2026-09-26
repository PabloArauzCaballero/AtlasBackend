/**
 * @file Fixture versionada: la imagen de un código QR sintético para las corridas QA.
 * @business Esta pieza deja que un comercio sintético suba un QR de cobro que el backend acepta
 *   (lleva un código legible), sin que ese código apunte jamás a una cuenta real.
 * @system generada una vez con `qrencode` (132×132, contenido «ATLAS-QA SINTETICO - NO ES UN QR DE
 *   COBRO») y codificada en JPEG con jpeg-js; el `sha256` fija el contenido. El comentario JPEG que
 *   añade el worker no toca los píxeles, así que el código sigue legible.
 */

export const SYNTHETIC_QR_IMAGE = {
  payment_qr: {
    sha256: '17c688c4c0ec64cabde8e90ea8461046c0afa7e99d801a9b554123fc3be5602d',
    bytes: 5917,
    base64:
      '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',
  },
} as const;
