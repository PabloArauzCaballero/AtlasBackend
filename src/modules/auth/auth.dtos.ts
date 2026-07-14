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

export type LogoutResponseDto = {
  loggedOut: boolean;
};

export type ProvisionCredentialsResponseDto = {
  provisioned: boolean;
};
