/**
 * @file Puerto de resolución del comercio declarado en una solicitud (AT-026).
 * @business El identificador del comercio lo manda el cliente; hay que comprobar que existe, que está
 *   aprobado y que la caja es suya, sin que Crédito importe los servicios de Comercios.
 * @system Interfaz + token; el adaptador local envuelve `PartnerProfileService` y `PartnerDirectoryService`.
 */
export type PartnerResolution = Readonly<{ partnerProfileId: string | null; posTerminalId: string | null }>;

export interface PartnerResolutionPort {
  /** Lanza `ApplicationError` (`PARTNER_NOT_AVAILABLE`) si el comercio no está aprobado. */
  resolve(tenantId: string, partnerProfileId: string | undefined, posTerminalId: string | undefined): Promise<PartnerResolution>;
}

export const PARTNER_RESOLUTION_PORT = 'atlas.credit.partner-resolution-port';
