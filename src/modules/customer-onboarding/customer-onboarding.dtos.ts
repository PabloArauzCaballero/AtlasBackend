/**
 * @file DTOs: contrato estable de salida sin filtrar modelos de persistencia.
 * @business Esta pieza convierte un registro inicial en un cliente verificable, conforme y listo para evaluación financiera.
 * @system orquesta perfil, contactos, identidad, documentos, dirección, referencias, screening y estado del flujo.
 */
/**
 * Credenciales de la sesión que abre el propio registro.
 *
 * `POST /start` devolvía solo identificadores, y el paso siguiente del flujo (verificar el contacto)
 * exige `Authorization: Bearer`. Sin estos campos la app tenía que encadenar un `POST /auth/login`
 * con la contraseña recién elegida para poder continuar — un paso que el registro ya había ganado.
 */
export type OnboardingSessionTokensDto = {
  accessToken: string;
  refreshToken: string;
  tokenType: 'Bearer';
  expiresIn: string;
};

export type StartOnboardingResponseDto = {
  customerId: string;
  customerCode: string | null;
  lifecycleStatus: string | null;
  onboardingFlowId: string | null;
  sessionId: string;
  deviceId: string;
  /** Código de sección del catálogo único (`ONBOARDING_SECTION_CODES`), no un literal por servicio. */
  nextStep: string;
  tokens: OnboardingSessionTokensDto;
};
