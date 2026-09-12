/**
 * @file DTOs: contrato estable de salida sin filtrar modelos de persistencia.
 * @business Esta pieza protege el acceso de clientes y operadores, la recuperación de cuenta y la continuidad segura de sesiones.
 * @system resuelve actores, credenciales, JWT, códigos de un solo uso y rotación/revocación de refresh tokens.
 */
export type LoginResponseDto = {
  accessToken: string;
  refreshToken: string;
  tokenType: 'Bearer';
  expiresIn: string;
};

export type LoginPinChallengeResponseDto = {
  pinChallengeRequired: true;
  challengeToken: string;
  expiresInMinutes: number;
};

export type PasswordResetRequestedResponseDto = {
  requested: boolean;
};

export type PasswordResetConfirmedResponseDto = {
  passwordChanged: boolean;
};

/**
 * Respuesta del primer paso del cambio de contraseña. Misma forma que el desafío del login
 * (`LoginPinChallengeResponseDto`) a propósito: el front reutiliza la pantalla del PIN sin
 * aprender un segundo contrato para lo mismo.
 */
export type PasswordChangeChallengeResponseDto = {
  pinChallengeRequired: true;
  challengeToken: string;
  expiresInMinutes: number;
};

export type LogoutResponseDto = {
  loggedOut: boolean;
};

export type ProvisionCredentialsResponseDto = {
  provisioned: boolean;
};
