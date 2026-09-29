/**
 * @file Servicio de aplicación: devuelve lo que el cliente ya contestó en el alta.
 * @business Volver a un paso del alta enseña lo ya escrito; sin esto, cada vuelta atrás era un formulario vacío.
 * @system sólo lectura: perfil vigente, atributos económicos vigentes y domicilio vigente (con la calle descifrada).
 */
import { Injectable, NotFoundException } from '@nestjs/common';
import { AuthenticatedUser } from '../../../common/types/auth.types.js';
import { assertOwnCustomerResourceOrInternalOperational } from '../../../common/utils/auth/ownership.util.js';
import { decryptSecretEnvelope } from '../../../common/utils/crypto/envelope-encryption.util.js';
import { FINANCIAL_ATTRIBUTE_CODES } from '../../customers/customer-eligibility.constants.js';
import { CustomersRepository } from '../../customers/customers.repository.js';
import { FinancialProfileDto } from '../customer-onboarding-profile.schemas.js';
import { CustomerOnboardingAnswersRepository } from '../repositories/customer-onboarding-answers.repository.js';
import { CustomerProfileDataRepository } from '../repositories/customer-profile-data.repository.js';
import { FIELD_TO_ATTRIBUTE_CODE } from './customer-financial-profile.service.js';

type FinancialAnswers = Partial<Record<keyof FinancialProfileDto, string | number>>;

export type OnboardingAnswers = {
  customerId: string;
  personalData: { firstName: string | null; lastName: string | null; birthDate: string | null } | null;
  financialProfile: FinancialAnswers;
  address: {
    countryCode: string | null;
    department: string | null;
    city: string | null;
    zone: string | null;
    addressLine: string | null;
    gps: { lat: number; lng: number; accuracyMeters: number | null } | null;
  } | null;
};

const ATTRIBUTE_CODE_TO_FIELD = new Map(
  Object.entries(FIELD_TO_ATTRIBUTE_CODE).map(([field, code]) => [code as string, field as keyof FinancialProfileDto]),
);

/** Un número guardado como `DECIMAL` llega como texto: se devuelve como número, que es como se envió. */
function toNumberOrNull(value: string | null): number | null {
  if (value === null) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * La calle se guarda cifrada. Si no se puede descifrar —valor heredado que ya venía opaco— se
 * devuelve `null`: la pantalla la pide otra vez, en lugar de enseñar un criptograma.
 */
async function decryptOrNull(value: string | null): Promise<string | null> {
  if (!value) return null;
  try {
    return await decryptSecretEnvelope(value);
  } catch {
    return null;
  }
}

@Injectable()
export class CustomerOnboardingAnswersService {
  constructor(
    private readonly customersRepository: CustomersRepository,
    private readonly profileDataRepository: CustomerProfileDataRepository,
    private readonly answersRepository: CustomerOnboardingAnswersRepository,
  ) {}

  async getAnswers(input: { tenantId: string; customerId: string; currentUser: AuthenticatedUser }): Promise<OnboardingAnswers> {
    assertOwnCustomerResourceOrInternalOperational(input.currentUser, input.customerId);
    const customer = await this.customersRepository.findById(input.tenantId, input.customerId);
    if (!customer) throw new NotFoundException('Cliente no encontrado.');

    return this.read(input.tenantId, input.customerId);
  }

  /**
   * Lo mismo SIN la comprobación de propiedad, para quien ya la hizo o no actúa en nombre de una
   * persona: el expediente del alta que se anexa al caso del Motor (`OnboardingReviewDossierService`).
   */
  async read(tenantId: string, customerId: string): Promise<OnboardingAnswers> {
    const [profile, financialProfile, address] = await Promise.all([
      this.profileDataRepository.findCurrentProfile(tenantId, customerId),
      this.readFinancialProfile(tenantId, customerId),
      this.readAddress(tenantId, customerId),
    ]);

    return {
      customerId,
      personalData: profile ? { firstName: profile.firstName, lastName: profile.lastName, birthDate: profile.birthDate } : null,
      financialProfile,
      address,
    };
  }

  private async readFinancialProfile(tenantId: string, customerId: string): Promise<FinancialAnswers> {
    const definitions = await this.profileDataRepository.findAttributeDefinitionsByCode(FINANCIAL_ATTRIBUTE_CODES);
    const codeByDefinitionId = new Map(definitions.map((row) => [String(row.id), row.attributeCode ?? '']));
    const values = await this.profileDataRepository.findCurrentAttributeValues(tenantId, customerId, [...codeByDefinitionId.keys()]);

    const answers: FinancialAnswers = {};
    for (const value of values) {
      const field = ATTRIBUTE_CODE_TO_FIELD.get(codeByDefinitionId.get(String(value.attributeDefinitionId)) ?? '');
      if (!field) continue;
      const number = toNumberOrNull(value.valueNumber ?? null);
      if (number !== null) answers[field] = number;
      else if (value.valueText !== null && value.valueText !== undefined) answers[field] = value.valueText;
    }
    return answers;
  }

  private async readAddress(tenantId: string, customerId: string): Promise<OnboardingAnswers['address']> {
    const version = await this.answersRepository.findCurrentHomeAddressVersion(tenantId, customerId);
    if (!version) return null;
    const gps = await this.answersRepository.findLatestGpsForAddressVersion(tenantId, String(version.id));
    const lat = toNumberOrNull(gps?.gpsLat ?? null);
    const lng = toNumberOrNull(gps?.gpsLng ?? null);
    return {
      countryCode: version.countryCode,
      department: version.department,
      city: version.city,
      zone: version.declaredZoneName,
      addressLine: await decryptOrNull(version.declaredAddressText),
      gps: lat !== null && lng !== null ? { lat, lng, accuracyMeters: toNumberOrNull(gps?.gpsAccuracyMeters ?? null) } : null,
    };
  }
}
