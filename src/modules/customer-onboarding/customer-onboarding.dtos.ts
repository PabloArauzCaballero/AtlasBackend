/**
 * @file DTOs: contrato estable de salida sin filtrar modelos de persistencia.
 * @business Esta pieza convierte un registro inicial en un cliente verificable, conforme y listo para evaluación financiera.
 * @system orquesta perfil, contactos, identidad, documentos, dirección, referencias, screening y estado del flujo.
 */
export type StartOnboardingResponseDto = {
  customerId: string;
  customerCode: string | null;
  lifecycleStatus: string | null;
  onboardingFlowId: string | null;
  sessionId: string;
  deviceId: string;
  nextStep: string;
};
