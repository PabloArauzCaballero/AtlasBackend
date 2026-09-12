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

/**
 * ESTADOS DE UNA PETICIÓN DE ALTA ENCOLADA POR EL ERP.
 *
 * `pending` la atiende el personal interno; `provisioned` ya tiene identidad detrás; `rejected` se
 * cerró con motivo. No hay «en curso»: aprobar es una transacción, o crea la identidad o no cambia
 * nada.
 */
export const MERCHANT_PROVISIONING_STATUSES = ['pending', 'provisioned', 'rejected'] as const;

/**
 * Lo que el ERP encola.
 *
 * NO lleva contraseña, y es la diferencia que da sentido a todo el cambio: quien pide el acceso no
 * fija la credencial. La genera Atlas al aprobar y se entrega una sola vez. Tampoco lleva
 * `tenantId`: sale del token de quien llama, igual que en el alta directa.
 */
export const enqueueMerchantUserRequestSchema = z.object({
  /** El identificador de la fila del ERP. Es la clave de idempotencia de la cola. */
  externalReference: z.string().trim().min(1).max(120),
  accountReference: z.string().trim().max(120).optional(),
  accountName: z.string().trim().max(180).optional(),
  branchName: z.string().trim().max(180).optional(),
  email: z.string().trim().email().max(180),
  fullName: z.string().trim().min(3).max(180),
  phone: z.string().trim().max(40).optional(),
  roleCode: z.string().trim().max(80).optional(),
  requestedBy: z.string().trim().max(180).optional(),
});
export type EnqueueMerchantUserRequestDto = z.infer<typeof enqueueMerchantUserRequestSchema>;

export const listMerchantUserRequestsQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(25),
  status: z.enum(MERCHANT_PROVISIONING_STATUSES).optional(),
  email: z.string().trim().max(180).optional(),
});
export type ListMerchantUserRequestsQueryDto = z.infer<typeof listMerchantUserRequestsQuerySchema>;

export const merchantUserRequestParamsSchema = z.object({ requestId: positiveId });
export type MerchantUserRequestParamsDto = z.infer<typeof merchantUserRequestParamsSchema>;

/**
 * Aprobar no admite datos de la persona: se toman de la petición.
 *
 * Dejar que el aprobador reescribiera el correo devolvería exactamente el problema que esto
 * resuelve —dos altas que no casan— con el agravante de que la petición diría una cosa y la
 * identidad otra. Lo único opcional es el `userCode`, que es un dato de Atlas y no del ERP.
 */
export const approveMerchantUserRequestSchema = z.object({
  userCode: z.string().trim().max(60).optional(),
});
export type ApproveMerchantUserRequestDto = z.infer<typeof approveMerchantUserRequestSchema>;

export const rejectMerchantUserRequestSchema = z.object({
  /** Obligatorio: el ERP lo lee y es lo que le dice qué corregir antes de volver a encolar. */
  reason: z.string().trim().min(8).max(500),
});
export type RejectMerchantUserRequestDto = z.infer<typeof rejectMerchantUserRequestSchema>;

export const merchantUserParamsSchema = z.object({ merchantUserId: positiveId });
export type MerchantUserParamsDto = z.infer<typeof merchantUserParamsSchema>;
