/**
 * @file Contrato público de Consentimiento (AT-028): estado vigente por sujeto y propósito.
 * @business Un proveedor o una operación sólo se ejecuta si existe consentimiento vigente PARA ESE
 *   propósito; el de otro propósito no autoriza nada. La revocación es idempotente y auditable.
 * @system Sólo valores. `revision` es la marca que un consumidor puede citar para decir «decidí con este
 *   estado»; una revocación posterior invalida autorizaciones FUTURAS y se propaga a proyecciones no
 *   críticas por evento. Ninguna decisión crítica cachea este estado: lo consulta en su transacción.
 */
export type ConsentStatusCode = 'granted' | 'revoked' | 'never_granted';

export type ConsentStatus = Readonly<{
  tenantId: string;
  customerId: string;
  purposeCode: string;
  status: ConsentStatusCode;
  /** Identificador del último registro de consentimiento para el propósito; `null` si nunca hubo. */
  revision: string | null;
  grantedAt: string | null;
  revokedAt: string | null;
  readAt: string;
}>;

export interface ConsentStatusPort {
  /** Estado vigente para UN propósito. Nunca devuelve el estado de otro propósito como sustituto. */
  getStatus(tenantId: string, customerId: string, purposeCode: string): Promise<ConsentStatus>;
}

export const CONSENT_STATUS_PORT = 'atlas.consents.status-port';

/** Reglas puras: decidir autorización a partir de un estado ya leído. Sin base ni reloj. */
export function authorizes(status: ConsentStatus, purposeCode: string): boolean {
  return status.purposeCode === purposeCode && status.status === 'granted';
}
