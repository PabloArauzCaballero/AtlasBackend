/**
 * @file Esquemas Zod: validan entradas y parámetros en el borde del sistema.
 * @business Esta pieza controla quién puede operar el canal del comercio afiliado y deja evidencia de cada alta.
 * @system implementa identidad del comercio, credenciales y ciclo de vida de sus usuarios.
 */
import { z } from 'zod';

/** Estados del ciclo de vida de una identidad de comercio. Sólo `active` puede iniciar sesión. */
export const MERCHANT_USER_STATUSES = ['invited', 'active', 'suspended', 'disabled'] as const;

const positiveId = z.string().regex(/^[1-9][0-9]*$/, 'Debe ser un identificador numérico positivo.');

export const merchantLoginSchema = z.object({
  // Igual que el login interno: el tenant puede venir por header o en el cuerpo.
  tenantId: positiveId.optional(),
  email: z.string().trim().email().max(180),
  password: z.string().min(1).max(128),
});
export type MerchantLoginDto = z.infer<typeof merchantLoginSchema>;

export const merchantRefreshSchema = z.object({
  refreshToken: z.string().trim().min(20).optional(),
});
export type MerchantRefreshDto = z.infer<typeof merchantRefreshSchema>;

export const merchantLogoutSchema = z.object({
  refreshToken: z.string().trim().min(20).optional(),
  allDevices: z.boolean().optional().default(false),
});
export type MerchantLogoutDto = z.infer<typeof merchantLogoutSchema>;

export const createMerchantUserSchema = z.object({
  tenantId: positiveId.optional(),
  email: z.string().trim().email().max(180),
  fullName: z.string().trim().min(3).max(180),
  phone: z.string().trim().max(40).optional(),
  userCode: z.string().trim().max(60).optional(),
  // Sin `.trim()`: misma regla que `provisionCredentialsSchema.password` — recortar aquí y no en
  // el login dejaría un hash que nunca vuelve a coincidir.
  password: z.string().min(10, 'La contraseña debe tener al menos 10 caracteres.').max(128),
});
export type CreateMerchantUserDto = z.infer<typeof createMerchantUserSchema>;

export const updateMerchantUserStatusSchema = z.object({
  status: z.enum(MERCHANT_USER_STATUSES),
  /** Queda en la auditoría operativa: suspender el acceso de un comercio se justifica. */
  reason: z.string().trim().min(8).max(500).optional(),
});
export type UpdateMerchantUserStatusDto = z.infer<typeof updateMerchantUserStatusSchema>;

export const listMerchantUsersQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(25),
  status: z.enum(MERCHANT_USER_STATUSES).optional(),
  email: z.string().trim().max(180).optional(),
});
export type ListMerchantUsersQueryDto = z.infer<typeof listMerchantUsersQuerySchema>;

export const merchantUserParamsSchema = z.object({ merchantUserId: positiveId });
export type MerchantUserParamsDto = z.infer<typeof merchantUserParamsSchema>;
