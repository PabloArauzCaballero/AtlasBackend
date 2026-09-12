/**
 * @file Tipos de dominio: hacen explícitos estados y contratos internos.
 * @business Esta pieza controla quién puede operar el canal del comercio afiliado y deja evidencia de cada alta.
 * @system implementa identidad del comercio, credenciales y ciclo de vida de sus usuarios.
 */

/** Proyección pública de una identidad de comercio. Nunca sale el hash ni el tenant interno. */
export type MerchantUserProfile = {
  id: string;
  email: string;
  fullName: string | null;
  userCode: string | null;
  phone: string | null;
  role: 'merchant';
  status: string;
  mustChangePassword: boolean;
  lastLoginAt: string | null;
};

export type MerchantAuthResponse = {
  accessToken: string;
  refreshToken: string;
  tokenType: 'Bearer';
  expiresIn: string;
  user: MerchantUserProfile;
};

/** Lo que ve el cliente cuando los tokens viajan en cookies `HttpOnly`. */
export type MerchantSessionResponse = Omit<MerchantAuthResponse, 'accessToken' | 'refreshToken' | 'tokenType'> & {
  tokenType: 'Cookie';
};

export type PaginatedMerchantUsers = {
  items: MerchantUserProfile[];
  page: number;
  limit: number;
  total: number;
};

/**
 * Una petición de alta encolada por el ERP, tal y como sale al portal.
 *
 * `merchantUserId` es el enlace de vuelta: el ERP lo copia en su `atlas_sales.merchant_users.user_id`
 * y con eso el alcance del portal del comercio deja de depender del enlace de respaldo por correo.
 */
export type MerchantUserProvisioningRequest = {
  id: string;
  source: string;
  externalReference: string;
  accountReference: string | null;
  accountName: string | null;
  branchName: string | null;
  email: string;
  fullName: string;
  phone: string | null;
  roleCode: string | null;
  requestedBy: string | null;
  requestedAt: string;
  status: string;
  merchantUserId: string | null;
  decidedAt: string | null;
  rejectionReason: string | null;
};

export type PaginatedMerchantUserRequests = {
  items: MerchantUserProvisioningRequest[];
  page: number;
  limit: number;
  total: number;
};

/**
 * El resultado de conceder un acceso.
 *
 * `temporaryPassword` viaja UNA sola vez, aquí. No se guarda en claro en ninguna parte, así que no
 * hay ninguna lectura posterior que la devuelva: quien apruebe tiene que entregarla en ese momento.
 */
export type MerchantUserProvisioningResult = {
  request: MerchantUserProvisioningRequest;
  merchantUser: MerchantUserProfile;
  temporaryPassword: string;
};
