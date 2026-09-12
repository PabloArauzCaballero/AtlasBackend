/**
 * @file Puerto de directorio de destinatarios (AT-020).
 * @business Mensajería necesita saber si un cliente tiene un contacto vigente y verificado para un canal;
 *   no necesita —ni debe— leer la tabla de contactos de Clientes.
 * @system Vive en plataforma para que ni Mensajería (consumidor) ni Clientes (implementador) dependan
 *   del otro módulo: el gate de fronteras detectó que un import de contrato entre ambos cerraba un ciclo. La
 *   respuesta es un valor: identificador opaco del contacto y su estado; nunca el teléfono ni el correo
 *   en claro, que Mensajería obtiene sólo al entregar y por su propio adaptador autorizado.
 */
export type RecipientChannelCode = 'in_app' | 'push' | 'email' | 'sms' | 'whatsapp' | 'phone';
export type RecipientKind = 'customer' | 'merchant' | 'internal_user' | 'operations' | 'system';

export type RecipientLookup = Readonly<{
  tenantId: string;
  recipient: Readonly<{ type: RecipientKind; id: string }>;
  channel: RecipientChannelCode;
}>;

export type RecipientResolution = Readonly<{
  /** `available` = hay contacto vigente y verificado; `unverified` = existe pero no verificado; `absent` = no hay. */
  status: 'available' | 'unverified' | 'absent' | 'unsupported';
  /** Identificador opaco del contacto en Clientes; `null` si no hay. */
  contactId: string | null;
  /** Instante de la lectura: el consumidor sabe cuán fresca es la respuesta. */
  resolvedAt: string;
}>;

export type DeliveryAddressLookup = RecipientLookup &
  Readonly<{ /** Propósito que autoriza usar el contacto (p. ej. `transactional`, `otp`, `marketing`). */ purpose: string }>;

export type DeliveryAddress = Readonly<{
  contactId: string;
  kind: 'email' | 'phone' | 'whatsapp';
  /** El valor en claro, sólo para entregar; nunca se persiste en Mensajería ni viaja en eventos. */
  address: string;
  resolvedAt: string;
}>;

export interface RecipientDirectoryPort {
  resolve(lookup: RecipientLookup): Promise<RecipientResolution>;
  /**
   * Direcciones de entrega vigentes y verificadas para el canal, autorizadas por el propósito. Vacío
   * cuando no hay contacto válido o el propósito no está permitido: nunca una dirección arbitraria.
   * El propósito `otp` acepta contactos aún no verificados (el OTP es precisamente cómo se verifican).
   */
  resolveDeliveryAddresses(lookup: DeliveryAddressLookup): Promise<readonly DeliveryAddress[]>;
}

export const RECIPIENT_DIRECTORY_PORT = 'atlas.notifications.recipient-directory-port';
