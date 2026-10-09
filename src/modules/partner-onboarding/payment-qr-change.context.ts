/**
 * @file Adaptador HTTP: traduce la sesión de quien llama al contexto que el caso de uso necesita.
 * @business Cambiar la cuenta de cobro de un comercio exige su contraseña repetida y deja dicho quién lo hizo.
 * @system decide si la petición necesita prueba de reautenticación, la comprueba y arma el actor de la auditoría.
 */
import type { AuthenticatedUser } from '../../common/types/auth.types.js';
import { RequestWithNetwork, firstHeader } from '../../common/utils/http/headers.util.js';
import type { PaymentQrReauth } from './application/payment-qr-reauth.port.js';
import type { PartnerQrChangeActor } from './partner-qr-audit.repository.js';

export type PaymentQrChangeContext = { actor: PartnerQrChangeActor; beforeWrite?: () => Promise<void> };

/**
 * Un COMERCIO cambia su QR con la contraseña repetida (`x-reauth-token`): su login no lleva segundo
 * factor obligatorio y sin esto una sesión robada bastaba para desviar sus cobros (ERP-03). La prueba
 * se comprueba aquí —para no descargar ni leer la imagen de quien no la trae— y se GASTA en
 * `beforeWrite`, justo antes de escribir: si la imagen no lleva QR, se corrige y se reintenta sin
 * volver a teclear. El personal interno no la necesita: entra con segundo factor obligatorio.
 */
export async function preparePaymentQrChange(
  reauth: PaymentQrReauth,
  currentUser: AuthenticatedUser,
  reauthToken: string | undefined,
  request: RequestWithNetwork,
): Promise<PaymentQrChangeContext> {
  const esComercio = Boolean(currentUser.merchantUserId) || currentUser.role === 'merchant';
  const actor: PartnerQrChangeActor = {
    actorType: esComercio ? 'merchant_user' : 'internal_user',
    merchantUserId: currentUser.merchantUserId ?? null,
    internalUserId: currentUser.internalUserId ?? null,
    reauthenticated: esComercio,
    ip: request.ip ?? null,
    userAgent: firstHeader(request.headers['user-agent']),
  };
  if (!esComercio) return { actor };

  const prueba = { actorType: 'merchant_user' as const, actorId: currentUser.merchantUserId ?? '', reauthToken };
  await reauth.assertValid(prueba);
  return { actor, beforeWrite: () => reauth.consume(prueba) };
}
