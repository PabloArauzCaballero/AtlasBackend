export type LoginResponseDto = {
  accessToken: string;
  refreshToken: string;
  tokenType: 'Bearer';
  expiresIn: string;
};

export type LogoutResponseDto = {
  loggedOut: boolean;
};

export type ProvisionCredentialsResponseDto = {
  provisioned: boolean;
};
