import { z } from 'zod';
import { INTERNAL_ROLE_CODES } from './internal-rbac.seed-data.js';

const positiveIdSchema = z.string().regex(/^[1-9][0-9]*$/);
const emailSchema = z
  .string()
  .trim()
  .email()
  .max(180)
  .transform((value) => value.toLowerCase());
const internalRoleCodeSchema = z.enum(INTERNAL_ROLE_CODES);

export const internalLoginSchema = z.object({
  tenantId: positiveIdSchema.optional(),
  email: emailSchema,
  password: z.string().min(1).max(128),
});

export type InternalLoginDto = z.infer<typeof internalLoginSchema>;

/**
 * `refreshToken` pasa a ser opcional: el panel interno ya no lo tiene en JavaScript — viaja en una
 * cookie `HttpOnly` que el navegador envía solo. Se mantiene aceptándolo en el body como fallback
 * para clientes que no son navegador (smoke tests, scripts, integraciones). El controller exige
 * que llegue por una de las dos vías.
 */
export const internalRefreshSchema = z.object({
  refreshToken: z.string().trim().min(20).optional(),
});

export type InternalRefreshDto = z.infer<typeof internalRefreshSchema>;

export const internalLogoutSchema = z.object({
  refreshToken: z.string().trim().min(20).optional(),
  allDevices: z.boolean().optional().default(false),
});

export type InternalLogoutDto = z.infer<typeof internalLogoutSchema>;

export const createInternalUserSchema = z.object({
  tenantId: positiveIdSchema.optional(),
  email: emailSchema,
  fullName: z.string().trim().min(3).max(180),
  userCode: z.string().trim().min(3).max(60).optional(),
  department: z
    .enum(['OPERATIONS', 'RISK', 'COLLECTIONS', 'COMPLIANCE', 'FINANCE', 'SUPPORT', 'SYSTEMS', 'AUDIT', 'EXECUTIVE'])
    .default('OPERATIONS'),
  jobTitle: z.string().trim().max(120).optional(),
  // Sin `.trim()`: igual que en `provisionCredentialsSchema` (módulo auth), `internalLoginSchema`
  // tampoco recorta la contraseña al verificar. Recortar solo aquí generaría un hash que nunca
  // volvería a coincidir si el valor real (el que el usuario recibió y escribe) tenía espacios.
  password: z.string().min(10, 'La contraseña debe tener al menos 10 caracteres.').max(128),
  mustChangePassword: z.boolean().optional().default(true),
  roles: z.array(internalRoleCodeSchema).min(1).max(8),
  reason: z.string().trim().min(8).max(500),
});

export type CreateInternalUserDto = z.infer<typeof createInternalUserSchema>;

export const updateInternalUserSchema = z.object({
  fullName: z.string().trim().min(3).max(180).optional(),
  department: z.enum(['OPERATIONS', 'RISK', 'COLLECTIONS', 'COMPLIANCE', 'FINANCE', 'SUPPORT', 'SYSTEMS', 'AUDIT', 'EXECUTIVE']).optional(),
  jobTitle: z.string().trim().max(120).nullable().optional(),
  status: z.enum(['active', 'invited', 'suspended', 'locked', 'disabled']).optional(),
  mustChangePassword: z.boolean().optional(),
  reason: z.string().trim().min(8).max(500),
});

export type UpdateInternalUserDto = z.infer<typeof updateInternalUserSchema>;

export const replaceInternalUserRolesSchema = z.object({
  roles: z.array(internalRoleCodeSchema).min(1).max(8),
  reason: z.string().trim().min(8).max(500),
});

export type ReplaceInternalUserRolesDto = z.infer<typeof replaceInternalUserRolesSchema>;

export const internalUserParamsSchema = z.object({
  internalUserId: positiveIdSchema,
});

export type InternalUserParamsDto = z.infer<typeof internalUserParamsSchema>;

export const listInternalUsersQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(50),
});

export type ListInternalUsersQueryDto = z.infer<typeof listInternalUsersQuerySchema>;
