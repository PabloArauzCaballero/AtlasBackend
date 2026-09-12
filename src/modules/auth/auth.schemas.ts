/**
 * @file Esquemas Zod: validan entradas y parámetros en el borde del sistema.
 * @business Esta pieza protege el acceso de clientes y operadores, la recuperación de cuenta y la continuidad segura de sesiones.
 * @system resuelve actores, credenciales, JWT, códigos de un solo uso y rotación/revocación de refresh tokens.
 */
import { z } from 'zod';

export const actorTypeSchema = z.enum(['customer', 'internal_user', 'platform_user', 'merchant_user']);

export const loginSchema = z.object({
  actorType: actorTypeSchema,
  // Para `customer`: teléfono o email (el mismo dato usado en onboarding).
  // Para `internal_user`/`platform_user`: email corporativo.
  // Para `merchant_user`: email con el que se dio de alta al usuario del comercio.
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
  /*
    Longitud sin minimo propio: la regla la pone `isSecretValidFor` segun el actor.

    Con `min(10)` aqui, un cliente NO PODIA recuperar su cuenta: registro y acceso usan un PIN de
    cuatro digitos y este esquema lo rechazaba antes de que el servicio —que ya distingue por tipo
    de actor desde hace tiempo— llegara a verlo. Quien olvidaba su PIN solo podia salir de ahi
    convirtiendolo en una contrasena larga que el resto de la app sigue llamando PIN.

    Es exactamente lo que advierte el comentario de `isSecretValidFor`: «asi acaba una cuenta con un
    PIN que su propio flujo de recuperacion no acepta». Sin `.trim()`, como el resto de secretos de
    este archivo: recortar cambiaria el valor que la persona escribio.
  */
  newPassword: z.string().min(1).max(128),
});

export type PasswordResetConfirmDto = z.infer<typeof passwordResetConfirmSchema>;

/**
 * Cambio de contraseña de un actor YA autenticado, en dos pasos y con el mismo segundo factor por
 * correo que el login. No lleva `actorType` ni `identifier`: quién cambia la contraseña lo dice el
 * access token, no el cuerpo. Aceptarlo del cuerpo convertiría el endpoint en un cambio de
 * contraseña ajena para cualquiera con un token válido.
 */
export const passwordChangeRequestSchema = z.object({
  // La contraseña actual se exige aquí, en el primer paso, para no gastar un correo ni abrir un
  // desafío a quien no puede probar que ya es el dueño de la sesión.
  currentPassword: z.string().min(1).max(128),
});

export type PasswordChangeRequestDto = z.infer<typeof passwordChangeRequestSchema>;

export const passwordChangeConfirmSchema = z.object({
  challengeToken: z.string().trim().min(20),
  code: z
    .string()
    .trim()
    .regex(/^\d{6}$/, 'El código debe tener exactamente 6 dígitos.'),
  /*
    Igual que en el restablecimiento: la regla la aplica el servicio, que sabe por el token si quien
    cambia su secreto es un cliente —PIN de cuatro digitos— o un usuario interno —contrasena larga—.
    Aqui no puede decidirse porque el cuerpo no lleva el tipo de actor, y con razon: aceptarlo del
    cuerpo convertiria esto en un cambio de contrasena ajena.
  */
  newPassword: z.string().min(1).max(128),
});

export type PasswordChangeConfirmDto = z.infer<typeof passwordChangeConfirmSchema>;

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
