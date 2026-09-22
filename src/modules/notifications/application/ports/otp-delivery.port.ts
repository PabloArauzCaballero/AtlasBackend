/**
 * @file Puerto de entrega de códigos de un solo uso (AT-040).
 * @business Un OTP vencido no se entrega como vigente; si el proveedor aceptó y la respuesta se perdió,
 *   el resultado es INCIERTO y quien llama no genera otro código a ciegas; un canal no soportado es un
 *   error explícito, nunca un éxito vacío. El código, su vigencia y su verificación siguen siendo del
 *   propietario (Onboarding/Auth): Mensajería sólo entrega material protegido ya autorizado.
 * @system Interfaz + token + catálogo de capacidades por canal. El adaptador local envuelve MailSender y
 *   los canales SMS/WhatsApp existentes.
 */
export type OtpChannel = 'email' | 'sms' | 'whatsapp';

export type OtpDeliveryRequest = Readonly<{
  tenantId: string;
  customerId: string;
  channel: OtpChannel;
  /** Dirección ya resuelta y autorizada por el propietario del contacto. */
  destination: string;
  code: string;
  /** Instante en que el código deja de valer: si ya pasó, no se entrega. */
  expiresAt: Date;
  ttlMinutes: number;
  /** Referencia estable del intento (idempotencia del proveedor cuando la soporta). */
  reference: string;
  /**
   * Correo del MISMO cliente al que llevar el código si el canal pedido no puede entregarlo.
   *
   * Lo resuelve y lo autoriza el propietario del contacto (Onboarding), que es quien sabe que ese
   * correo es de esta persona; Mensajería no lo busca por su cuenta. Sin valor no hay reserva y un
   * canal caído sigue siendo un fallo, que es el comportamiento de siempre.
   */
  fallbackEmail?: string | null;
  now?: Date;
}>;

export type OtpDeliveryOutcome = Readonly<{
  delivered: boolean;
  provider: string;
  errorCode: string | null;
  /**
   * Canal por el que SALIÓ de verdad, que no siempre es el que se pidió.
   *
   * Se devuelve para que quien llama no tenga que deducirlo del `provider`: un código de teléfono
   * entregado por correo tiene que poder decirse en la pantalla y quedar escrito en el intento.
   */
  channel?: OtpChannel;
  /**
   * `true` cuando el proveedor pudo haber enviado (timeout tras aceptar): el llamador reconcilia por
   * `reference` o espera; NO emite un código nuevo ni reenvía con otra clave.
   */
  uncertain: boolean;
}>;

export type ChannelCapability = Readonly<{ channel: OtpChannel; available: boolean; idempotentByReference: boolean; provider: string }>;

export interface OtpDeliveryPort {
  capabilities(): readonly ChannelCapability[];
  deliver(request: OtpDeliveryRequest): Promise<OtpDeliveryOutcome>;
}

export const OTP_DELIVERY_PORT = 'atlas.notifications.otp-delivery-port';

export const OTP_ERRORS = Object.freeze({
  expired: 'OTP_EXPIRED',
  unsupported: 'OTP_CHANNEL_UNSUPPORTED',
  failed: 'DELIVERY_FAILED',
  uncertain: 'DELIVERY_UNCERTAIN',
});
