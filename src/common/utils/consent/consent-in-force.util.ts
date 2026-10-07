/**
 * @file Cuándo un consentimiento ampara USAR un dato que ya se guardó.
 * @business Quien retira el permiso de su agenda o de su ubicación no puede seguir pesando en una decisión por los
 *   datos que entregó antes: lo guardado deja de leerse en el momento en que la última decisión es un «no».
 * @system función pura sobre la ÚLTIMA fila de `privacy.customer_consents` de una finalidad.
 */

/** Lo mínimo de una fila de consentimiento. */
export type ConsentRowLike = { granted: boolean | null; revokedAt: Date | null } | null | undefined;

/**
 * Vigente = la ÚLTIMA decisión de esa finalidad es un «sí» que no se ha retirado.
 *
 * Mirar la última, y no «alguna concedida sin `revoked_at`», es el punto: la app registra la negativa como una fila
 * NUEVA (`granted = false`) y la concesión anterior se queda sin marca de retiro. Buscar cualquier concesión viva
 * seguía autorizando a quien ya había dicho que no.
 */
export function isConsentInForce(latest: ConsentRowLike): boolean {
  return Boolean(latest) && latest!.granted === true && latest!.revokedAt === null;
}

/** Las finalidades que amparan las señales del teléfono. Son los códigos que siembra `privacy`. */
export const ADDRESS_BOOK_PURPOSE = 'device_address_book';
export const LOCATION_TRACKING_PURPOSE = 'location_tracking';
