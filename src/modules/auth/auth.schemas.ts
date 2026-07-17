import { z } from 'zod';

export const actorTypeSchema = z.enum(['customer', 'internal_user', 'platform_user']);

export const loginSchema = z.object({
  actorType: actorTypeSchema,
  // Para `customer`: teléfono o email (el mismo dato usado en onboarding).
  // Para `internal_user`/`platform_user`: email corporativo.
  identifier: z.string().trim().min(3).max(180),
  password: z.string().min(1).max(128),
});

export type LoginDto = z.infer<typeof loginSchema>;

export const refreshSchema = z.object({
  refreshToken: z.string().trim().min(20),
});

export type RefreshDto = z.infer<typeof refreshSchema>;

export const logoutSchema = z.object({
  refreshToken: z.string().trim().min(20),
  allDevices: z.boolean().optional().default(false),
});

export type LogoutDto = z.infer<typeof logoutSchema>;

// Fase 4.2: preferencia de MFA opt-in del cliente.
export const mfaPreferenceSchema = z.object({
  enabled: z.boolean(),
});
export type MfaPreferenceDto = z.infer<typeof mfaPreferenceSchema>;

export const loginPinVerifySchema = z.object({
  challengeToken: z.string().trim().min(20),
  pin: z
    .string()
    .trim()
    .regex(/^\d{6}$/, 'El PIN debe tener exactamente 6 dígitos.'),
});

export type LoginPinVerifyDto = z.infer<typeof loginPinVerifySchema>;

// El identificador del reset es siempre un email: es el canal por el que se entrega el código.
const resetIdentifierSchema = z.string().trim().email().max(180);

export const passwordResetRequestSchema = z.object({
  actorType: actorTypeSchema,
  identifier: resetIdentifierSchema,
});

export type PasswordResetRequestDto = z.infer<typeof passwordResetRequestSchema>;

export const passwordResetConfirmSchema = z.object({
  actorType: actorTypeSchema,
  identifier: resetIdentifierSchema,
  code: z
    .string()
    .trim()
    .regex(/^\d{6}$/, 'El código debe tener exactamente 6 dígitos.'),
  // Sin `.trim()`: misma regla que `provisionCredentialsSchema.password` (ver nota abajo).
  newPassword: z.string().min(10, 'La contraseña debe tener al menos 10 caracteres.').max(128),
});

export type PasswordResetConfirmDto = z.infer<typeof passwordResetConfirmSchema>;

export const provisionCredentialsSchema = z.object({
  actorType: z.enum(['internal_user', 'platform_user']),
  actorId: z.string().regex(/^[1-9][0-9]*$/),
  // Sin `.trim()`: `loginSchema.password` tampoco recorta espacios antes de verificar. Si aquí
  // se recortara antes de hashear, una contraseña con espacio inicial/final quedaría hasheada
  // sin él, pero `login` compararía el valor tal cual lo escribe el usuario (con el espacio) —
  // el hash nunca volvería a coincidir. Deben tratar el valor exactamente igual en ambos lados.
  password: z.string().min(10, 'La contraseña debe tener al menos 10 caracteres.').max(128),
});

export type ProvisionCredentialsDto = z.infer<typeof provisionCredentialsSchema>;
