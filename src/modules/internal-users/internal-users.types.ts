export type InternalAccessProfile = {
  user: {
    id: string;
    tenantId: string;
    email: string;
    fullName: string;
    name: string;
    userCode: string | null;
    status: string;
    department: string | null;
    jobTitle: string | null;
    mustChangePassword: boolean;
    mfaEnabled: boolean;
    roles: string[];
    legacyRoles: string[];
    permissions: string[];
  };
};

/**
 * Respuesta del dominio: SÍ lleva los tokens. No se devuelve tal cual por HTTP — el controller los
 * mueve a cookies `HttpOnly` y entrega `InternalSessionResponse`.
 */
export type InternalAuthResponse = {
  accessToken: string;
  refreshToken: string;
  tokenType: 'Bearer';
  expiresIn: string;
} & InternalAccessProfile;

/**
 * Lo que ve el cliente HTTP: perfil y metadatos, sin un solo token. `tokenType: 'Cookie'` es la
 * señal que el portal ya sabe interpretar para dejar de persistir credenciales en `sessionStorage`.
 */
export type InternalSessionResponse = {
  tokenType: 'Cookie';
  expiresIn: string;
} & InternalAccessProfile;

export type CreateInternalUserInput = {
  tenantId: string;
  email: string;
  fullName: string;
  userCode: string | null;
  department: string;
  jobTitle: string | null;
  passwordHash: string;
  mustChangePassword: boolean;
  roleCodes: string[];
  legacyRoleCode: string;
  createdByInternalUserId: string | null;
};

export type InternalUserListItem = InternalAccessProfile['user'];
