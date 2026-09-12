/**
 * @file Contrato publicable del worker de autenticación (`atlas-auth-broker-worker`).
 * @business Esta pieza incorpora evidencia KYC, financiera y de confianza con control de costo, consentimiento y disponibilidad.
 * @system aísla proveedores detrás de adaptadores resilientes y políticas de gobierno, ejecución y evidencia.
 */

/**
 * Espejo del contrato que expone el worker. Se declara aquí en vez de importar el paquete para no
 * acoplar el despliegue del backend al del worker: son dos servicios con ciclos de vida distintos,
 * y el contrato HTTP es la frontera.
 *
 * Todo lo declarado en este archivo es PUBLICABLE: ni un solo campo lleva material de credencial.
 * La única respuesta del worker que contiene un secreto real —las cabeceras de `authorize`— no
 * tiene tipo aquí porque no debe atravesar la capa HTTP del backend hacia el portal.
 */

export type ProviderAuthMethod = 'oauth2_client_credentials' | 'jwt_bearer' | 'mtls' | 'api_key' | 'none';

export type ProviderCredentialStatus = 'ACTIVE' | 'MISSING' | 'EXPIRED' | 'ROTATION_DUE' | 'REVOKED' | 'NOT_REQUIRED';

export type ProviderAccessTokenStatus = 'VALID' | 'EXPIRING' | 'EXPIRED' | 'NONE' | 'REFRESH_FAILED';

export type ProviderAuthState = {
  providerCode: string;
  authMethod: ProviderAuthMethod;
  credentialStatus: ProviderCredentialStatus;
  tokenStatus: ProviderAccessTokenStatus;
  /** Huella SHA-256 truncada: identifica QUÉ credencial está activa sin revelarla. */
  credentialFingerprint?: string;
  scopes: string[];
  issuedAt?: string;
  rotatedAt?: string;
  rotationDueAt?: string;
  credentialAgeDays?: number;
  tokenExpiresAt?: string;
  lastRefreshAt?: string;
  lastFailureCode?: string;
  lastFailureAt?: string;
};

export type ProviderCredentialRotationResult = {
  providerCode: string;
  field: string;
  fingerprint: string;
  rotatedAt: string;
};

export type ProviderCredentialRevocationResult = {
  revokedAt: string;
};

/**
 * Estado del propio broker, para la readiness del backend y para el portal.
 *
 * `configured: false` no es un error: significa que este despliegue todavía no delega la
 * autenticación al worker. El portal debe decirlo así, en vez de pintar un fallo.
 */
export type AuthBrokerAvailability = {
  configured: boolean;
  reachable: boolean;
  vaultDriver?: string;
  errorCode?: string;
};
