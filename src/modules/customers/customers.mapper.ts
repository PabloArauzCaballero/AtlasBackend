/**
 * @file Mapper: transforma modelos internos a contratos de transporte.
 * @business Esta pieza mantiene la identidad operativa, ciclo de vida y elegibilidad del cliente como fuente de verdad.
 * @system expone casos de uso de cliente, evaluación de condiciones y transiciones de estado persistidas.
 */
import {
  CustomerConsentModel,
  CustomerContactMethodModel,
  CustomerModel,
  CustomerProfileVersionModel,
  OnboardingFlowModel,
  RiskAssessmentResultModel,
} from '../../database/models/index.js';
import { EligibilityAssessment } from './application/customer-eligibility.evaluator.js';
import { CustomerMeResponseDto, CustomerProfileResponseDto, CustomerResponseDto } from './customers.dtos.js';
import { toIsoOrNull } from '../../common/utils/dates/date.util.js';

export function toCustomerResponse(customer: CustomerModel): CustomerResponseDto {
  return {
    id: String(customer.id),
    tenantId: String(customer.tenantId),
    customerCode: customer.customerCode,
    customerUuid: customer.customerUuid,
    lifecycleStatus: customer.lifecycleStatus,
    primaryPhoneLast4: customer.primaryPhoneLast4,
    primaryEmailDomain: customer.primaryEmailDomain,
    currentProfileVersionId: customer.currentProfileVersionId === null ? null : String(customer.currentProfileVersionId),
    createdAt: customer.createdAtValue.toISOString(),
  };
}

export function toCustomerProfileResponse(profile: CustomerProfileVersionModel): CustomerProfileResponseDto {
  return {
    id: String(profile.id),
    firstName: profile.firstName,
    lastName: profile.lastName,
    fullNameNormalized: profile.fullNameNormalized,
    birthDate: profile.birthDate,
    preferredLanguage: profile.preferredLanguage,
    marketingOptIn: profile.marketingOptIn,
    validFrom: toIsoOrNull(profile.validFrom),
  };
}

export function toCustomerMeResponse(input: {
  customer: CustomerModel;
  profile: CustomerProfileVersionModel | null;
  contacts: CustomerContactMethodModel[];
  consents: CustomerConsentModel[];
  riskResult: RiskAssessmentResultModel | null;
  onboardingFlow: OnboardingFlowModel | null;
  assessment: EligibilityAssessment;
}): CustomerMeResponseDto {
  const acceptedPurposeCodes = input.consents
    .filter((c) => c.granted === true)
    .map((c) => c.purposeCode)
    .filter((code): code is string => code !== null);

  const declinedPurposeCodes = input.consents
    .filter((c) => c.granted === false)
    .map((c) => c.purposeCode)
    .filter((code): code is string => code !== null);

  return {
    customer: {
      customerId: String(input.customer.id),
      customerCode: input.customer.customerCode,
      status: input.customer.lifecycleStatus,
      phoneLast4: input.customer.primaryPhoneLast4,
      emailDomain: input.customer.primaryEmailDomain,
    },
    profile: input.profile
      ? {
          firstName: input.profile.firstName,
          lastName: input.profile.lastName,
          birthDate: input.profile.birthDate,
          preferredLanguage: input.profile.preferredLanguage,
        }
      : null,
    // CORRECCIÓN (H3): este campo estaba fijado en `null` con el comentario "onboarding_flows table
    // not present in current schema". La tabla SÍ existe, se escribe en el registro y la consultan
    // tres servicios de onboarding; el comentario venía de una fase anterior del proyecto y nadie
    // volvió a conectar el dato real con la respuesta.
    onboarding: input.onboardingFlow
      ? {
          onboardingFlowId: String(input.onboardingFlow.id),
          flowVersion: input.onboardingFlow.flowVersion,
          completionStatus: input.onboardingFlow.completionStatus,
          startedAt: toIsoOrNull(input.onboardingFlow.startedAt),
          completedAt: toIsoOrNull(input.onboardingFlow.completedAt),
          abandonedAt: toIsoOrNull(input.onboardingFlow.abandonedAt),
        }
      : null,
    eligibility: {
      eligible: input.assessment.eligible,
      completionPercentage: input.assessment.completionPercentage,
      blockerCodes: input.assessment.blockers.map((blocker) => blocker.code),
    },
    contacts: input.contacts.map((c) => ({
      contactType: c.contactType,
      status: c.status,
      isPrimary: c.isPrimary,
      valueLast4: c.valueLast4,
    })),
    consents: {
      accepted: acceptedPurposeCodes,
      declined: declinedPurposeCodes,
    },
    risk: input.riskResult
      ? {
          latestDecision: input.riskResult.recommendedAction,
          latestRiskLevel: input.riskResult.riskLevel,
        }
      : null,
    // El `nextStep` viene del MISMO evaluador que decide la habilitación. Antes se calculaba aquí
    // sobre `pending_review`/`approved`, valores que ningún código escribía: un cliente que ya había
    // enviado sus documentos recibía `identity_capture` y la app le pedía volver a subirlos.
    nextStep: input.assessment.nextStep,
  };
}
