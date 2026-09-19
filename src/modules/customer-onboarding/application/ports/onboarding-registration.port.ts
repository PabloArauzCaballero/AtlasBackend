/**
 * @file Puerto de registro atómico del alta (AT-025).
 * @business El alta escribe cliente, contactos, consentimientos, credenciales, flujo y sesión «o todo o
 *   nada». El caso de uso pide UNA operación al puerto y recibe identificadores; no ve la transacción.
 * @system Interfaz + token. El adaptador real compone `LegacyOnboardingAtomicBridge` con los repositorios
 *   de los cinco módulos (es el único lugar autorizado para esa composición: excepción
 *   `onboarding-atomic-bridge` del manifiesto). La preparación (hash Argon2, deduplicación, validación
 *   de consentimientos) ocurre ANTES y fuera del puerto; la entrega de OTP, DESPUÉS.
 */
import type { StartOnboardingResponseDto } from '../../customer-onboarding.dtos.js';
import type { StartOnboardingDto } from '../../customer-onboarding.schemas.js';

export type RegistrationCommand = Readonly<{
  tenantId: string;
  idempotencyKey: string;
  /** Cuerpo validado del alta (perfil, contactos, consentimientos, dispositivo) SIN la contraseña en claro: sólo viaja su hash. */
  registration: Omit<StartOnboardingDto, 'password'>;
  /** Ya hasheada con Argon2 fuera de la transacción. */
  passwordHash: string;
  phoneHash: string | null;
  emailHash: string | null;
  sourceType: string;
  ipAddress: string | null;
  now: Date;
}>;

export type RegistrationResult = Readonly<{
  customerId: string;
  onboardingFlowId: string;
  sessionId: string | null;
  /** Contrato HTTP previo del alta, sin cambios (AT-025). */
  response: StartOnboardingResponseDto;
}>;

export interface OnboardingRegistrationPort {
  /**
   * Ejecuta el grupo atómico. Lanza `ApplicationError('CUSTOMER_ALREADY_EXISTS')` cuando el índice único
   * de contacto lo rechaza (la carrera que el chequeo previo puede perder). No hace E/S de red dentro.
   */
  register(command: RegistrationCommand): Promise<RegistrationResult>;
}

export const ONBOARDING_REGISTRATION_PORT = 'atlas.onboarding.registration-port';
