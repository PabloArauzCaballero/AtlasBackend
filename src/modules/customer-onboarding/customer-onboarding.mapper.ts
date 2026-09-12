/**
 * @file Mapper: transforma modelos internos a contratos de transporte.
 * @business Esta pieza convierte un registro inicial en un cliente verificable, conforme y listo para evaluación financiera.
 * @system orquesta perfil, contactos, identidad, documentos, dirección, referencias, screening y estado del flujo.
 */
import { CustomerModel, CustomerSessionModel, DeviceModel, OnboardingFlowModel } from '../../database/models/index.js';
import { ONBOARDING_SECTION_CODES } from '../customers/customer-eligibility.constants.js';
import { OnboardingSessionTokensDto, StartOnboardingResponseDto } from './customer-onboarding.dtos.js';

/**
 * Primera sección del catálogo único de onboarding.
 *
 * Se toma de `ONBOARDING_SECTION_CODES` en vez de escribir `'verify_contact'` a mano: el literal
 * anterior no existía en el vocabulario que el evaluador devuelve en todos los demás pasos, así que
 * la app recibía un código en el registro y otro distinto —para el mismo paso— en cuanto consultaba
 * el estado.
 */
const FIRST_ONBOARDING_STEP = ONBOARDING_SECTION_CODES[0];

export function toStartOnboardingResponse(input: {
  customer: CustomerModel;
  session: CustomerSessionModel;
  device: DeviceModel;
  onboardingFlow: OnboardingFlowModel;
  tokens: OnboardingSessionTokensDto;
}): StartOnboardingResponseDto {
  return {
    customerId: String(input.customer.id),
    customerCode: input.customer.customerCode,
    lifecycleStatus: input.customer.lifecycleStatus,
    onboardingFlowId: String(input.onboardingFlow.id),
    sessionId: String(input.session.id),
    deviceId: String(input.device.id),
    nextStep: FIRST_ONBOARDING_STEP,
    tokens: input.tokens,
  };
}
