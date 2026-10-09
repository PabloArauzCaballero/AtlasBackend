/**
 * @file Regla de dominio acotada: una comprobación que el caso de uso aplica antes de escribir.
 * @business Un QR de cobro tiene que llevar un código que el banco del cliente sepa leer; una foto del local no cobra nada.
 * @system lee el objeto subido y rechaza la imagen sin código QR legible, sin guardar ni registrar lo decodificado.
 */
import { Logger, UnprocessableEntityException } from '@nestjs/common';
import { leerQrDeImagen } from '../../../common/images/qr-image-reader.js';
import type { DocumentStorageService } from '../../../common/storage/document-storage.service.js';
import type { MetricsService } from '../../../common/observability/metrics.service.js';

type Deps = {
  storage: Pick<DocumentStorageService, 'readObject'>;
  metrics: Pick<MetricsService, 'recordPartnerOnboardingStep'>;
  logger: Logger;
};

/**
 * La imagen tiene que LLEVAR un código QR. No basta con que sea una imagen.
 *
 * Ésta era la puerta abierta: se comprobaba el tipo, el tamaño y el hash del objeto —todo cierto
 * y todo insuficiente—, así que una foto del local, una captura de pantalla o un archivo en
 * blanco entraban igual y el expediente quedaba afirmando que el comercio tiene QR de cobro. El
 * fallo no se veía aquí: se veía en la caja, con el cliente delante intentando escanear una
 * fotografía. Por eso se rechaza en el registro y no sólo en el navegador: el navegador se puede
 * saltar, y quien sube el QR de cobro está declarando a qué cuenta va el dinero de sus clientes.
 *
 * El contenido decodificado NO se guarda ni se registra: en el QR bancario es un número de
 * cuenta. Sólo se usa para responder si hay código o no.
 *
 * Salió de `PartnerQrService` (2026-10-09) para dejar sitio a la reautenticación y la auditoría del
 * cambio sin pasar del límite de tamaño.
 */
export async function assertImagenContieneQr(deps: Deps, qr: { qrKind: string; storageKey: string }, contentType: string): Promise<void> {
  const { qrKind, storageKey } = qr;
  const contenido = await deps.storage.readObject(storageKey);
  if (!contenido) {
    deps.metrics.recordPartnerOnboardingStep({ step: `qr_${qrKind}`, outcome: 'rejected' });
    throw new UnprocessableEntityException('QR_OBJECT_NOT_READABLE: no se pudo leer el objeto subido.');
  }

  const lectura = leerQrDeImagen(contenido, contentType);
  if (lectura.ok) return;

  deps.metrics.recordPartnerOnboardingStep({ step: `qr_${qrKind}`, outcome: 'rejected' });
  deps.logger.warn(`Imagen rechazada como QR: tipo=${qrKind} motivo=${lectura.motivo} clave=${storageKey}`);

  if (lectura.motivo === 'SIN_CODIGO') {
    throw new UnprocessableEntityException(
      'QR_IMAGE_HAS_NO_CODE: la imagen no contiene ningún código QR legible. Sube la imagen del código, no una foto del local ni una captura de pantalla.',
    );
  }
  if (lectura.motivo === 'IMAGEN_DEMASIADO_GRANDE') {
    throw new UnprocessableEntityException(
      'QR_IMAGE_TOO_LARGE: la imagen tiene demasiados píxeles para poder leerla. Vuelve a fotografiar el código más de cerca o reduce su tamaño.',
    );
  }
  throw new UnprocessableEntityException(`QR_IMAGE_UNREADABLE: no se pudo interpretar la imagen (${lectura.motivo}).`);
}
