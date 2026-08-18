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
