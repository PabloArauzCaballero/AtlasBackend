/**
 * @file Las compuertas de estado del expediente del comercio: qué se puede tocar y cuándo.
 * @business Un expediente en revisión no se mueve, pero un QR de cobro sí: son reglas distintas y aquí están juntas.
 * @system funciones puras sobre el perfil; sin repositorio, sin inyección y sin efectos.
 */
import { UnprocessableEntityException } from '@nestjs/common';
import { PartnerProfileModel } from '../../../database/models/index.js';
import {
  COMMERCIAL_NETWORK_EDITABLE_STATUSES,
  EDITABLE_PARTNER_STATUSES,
  PAYMENT_QR_EDITABLE_STATUSES,
} from '../partner-onboarding.repository.js';

/*
 * Son funciones y no métodos porque no dependen de nada: miran el estado del expediente y deciden.
 * Vivían en `PartnerProfileService`, que además abre expedientes, guarda evidencia y los envía a
 * revisión; ahí obligaban a leer el ciclo de vida entero para encontrar una regla de tres líneas.
 * Las tres compuertas juntas se leen mejor: es donde se ve que NO son la misma.
 */

/**
 * Un expediente ya enviado o resuelto no admite cambios del comercio.
 *
 * Sin esta puerta, un comercio podría cambiar su QR bancario mientras un analista mira el
 * expediente, y la aprobación quedaría firmada sobre datos que ya no son los que se revisaron.
 */
export function assertEditable(profile: PartnerProfileModel): void {
  if (!EDITABLE_PARTNER_STATUSES.includes(profile.onboardingStatus as (typeof EDITABLE_PARTNER_STATUSES)[number])) {
    throw new UnprocessableEntityException(`PARTNER_NOT_EDITABLE_IN_STATUS: ${profile.onboardingStatus}`);
  }
}

/**
 * Igual que `assertEditable`, pero para la red comercial: sucursales y terminales.
 *
 * Un comercio aprobado sigue abriendo locales y rotando POS; ese movimiento no toca nada de lo que
 * el analista firmó, así que no tiene por qué morir con la aprobación.
 */
export function assertCommercialNetworkEditable(profile: PartnerProfileModel): void {
  if (!COMMERCIAL_NETWORK_EDITABLE_STATUSES.includes(profile.onboardingStatus as (typeof COMMERCIAL_NETWORK_EDITABLE_STATUSES)[number])) {
    throw new UnprocessableEntityException(`PARTNER_NETWORK_NOT_EDITABLE_IN_STATUS: ${profile.onboardingStatus}`);
  }
}

/**
 * Igual que `assertEditable`, pero para el QR DE COBRO.
 *
 * El comercio aprobado —el único que de verdad cobra— no podía subir el suyo, así que la app no
 * tenía qué enseñar cuando el cliente pulsaba «pagar». Un QR no se edita: se reemplaza, y el
 * anterior queda archivado apuntando al nuevo, de modo que abrir esta puerta no borra nada de lo
 * que hubo antes.
 */
export function assertPaymentQrEditable(profile: PartnerProfileModel): void {
  if (!PAYMENT_QR_EDITABLE_STATUSES.includes(profile.onboardingStatus as (typeof PAYMENT_QR_EDITABLE_STATUSES)[number])) {
    throw new UnprocessableEntityException(`PARTNER_QR_NOT_EDITABLE_IN_STATUS: ${profile.onboardingStatus}`);
  }
}
