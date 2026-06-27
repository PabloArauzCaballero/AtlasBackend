import { ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectConnection } from '@nestjs/sequelize';
import { randomUUID } from 'node:crypto';
import { Sequelize } from 'sequelize-typescript';
import { AuthenticatedUser } from '../../common/types/auth.types.js';
import { createStableCode, hashSensitiveText, lastCharacters, normalizeSensitiveText } from '../../common/utils/crypto/hash.util.js';
import { CustomersRepository } from './customers.repository.js';
import { CustomerRegistrationResponseDto, CustomerSummaryResponseDto } from './customers.dtos.js';
import { RegisterCustomerDto } from './customers.schemas.js';
import { toCustomerProfileResponse, toCustomerResponse, toCustomerSummaryResponse } from './customers.mapper.js';

function normalizeFullName(firstName: string | undefined, lastName: string | undefined): string | null {
  const fullName = [firstName, lastName]
    .filter((value): value is string => value !== undefined && value.trim().length > 0)
    .join(' ')
    .trim();

  return fullName.length === 0 ? null : fullName.toLocaleLowerCase('es-BO');
}

function emailDomain(email: string | undefined): string | null {
  if (!email) {
    return null;
  }

  const domain = email.split('@')[1];
  return domain ? normalizeSensitiveText(domain) : null;
}

function assertCustomerAccess(customerId: string, currentUser: AuthenticatedUser): void {
  if (currentUser.role === 'customer' && currentUser.customerId !== customerId) {
    throw new ForbiddenException('El token del cliente no corresponde al recurso solicitado.');
  }
}

@Injectable()
export class CustomersService {
  constructor(
    private readonly customersRepository: CustomersRepository,
    @InjectConnection() private readonly sequelize: Sequelize,
  ) {}

  async registerCustomer(tenantId: string, input: RegisterCustomerDto): Promise<CustomerRegistrationResponseDto> {
    const createdAt = new Date();
    const phoneHash = input.phone ? hashSensitiveText(input.phone) : null;
    const emailHash = input.email ? hashSensitiveText(input.email) : null;
    const existingCustomer = await this.customersRepository.findByContactHash(tenantId, {
      phoneHash: phoneHash ?? undefined,
      emailHash: emailHash ?? undefined,
    });

    if (existingCustomer) {
      throw new ConflictException('Ya existe un cliente activo con ese teléfono o email hasheado.');
    }

    return this.sequelize.transaction(async (transaction) => {
      const customer = await this.customersRepository.createCustomer(
        {
          tenantId,
          customerCode: createStableCode('CUS'),
          customerUuid: randomUUID(),
          primaryPhoneHash: phoneHash,
          primaryPhoneLast4: input.phone ? lastCharacters(input.phone, 4) : null,
          primaryEmailHash: emailHash,
          primaryEmailDomain: emailDomain(input.email),
          lifecycleStatus: 'registered',
          createdAt,
        },
        { transaction },
      );

      const profile = await this.customersRepository.createProfileVersion(
        {
          tenantId,
          customerId: String(customer.id),
          firstName: input.firstName ?? null,
          lastName: input.lastName ?? null,
          fullNameNormalized: normalizeFullName(input.firstName, input.lastName),
          birthDate: input.birthDate ?? null,
          preferredLanguage: input.preferredLanguage,
          marketingOptIn: input.marketingOptIn,
          sourceType: input.sourceType,
          createdAt,
        },
        { transaction },
      );

      await this.customersRepository.updateCurrentProfileVersion(customer, String(profile.id), createdAt, { transaction });

      if (phoneHash) {
        await this.customersRepository.createContactMethod(
          {
            tenantId,
            customerId: String(customer.id),
            contactType: 'phone',
            contactValueHash: phoneHash,
            valueLast4: input.phone ? lastCharacters(input.phone, 4) : null,
            emailDomain: null,
            isPrimary: true,
            sourceType: input.sourceType,
            createdAt,
          },
          { transaction },
        );
      }

      if (emailHash) {
        await this.customersRepository.createContactMethod(
          {
            tenantId,
            customerId: String(customer.id),
            contactType: 'email',
            contactValueHash: emailHash,
            valueLast4: null,
            emailDomain: emailDomain(input.email),
            isPrimary: phoneHash === null,
            sourceType: input.sourceType,
            createdAt,
          },
          { transaction },
        );
      }

      await this.customersRepository.createStatusEvent(
        {
          tenantId,
          customerId: String(customer.id),
          previousStatus: null,
          newStatus: 'registered',
          reasonCode: 'customer_registered',
          changedByType: 'system',
          happenedAt: createdAt,
          notes: 'Registro inicial desde endpoint público de onboarding.',
        },
        { transaction },
      );

      return {
        customer: toCustomerResponse(customer),
        profile: toCustomerProfileResponse(profile),
      };
    });
  }

  async getCustomerSummary(
    tenantId: string,
    customerId: string,
    currentUser: AuthenticatedUser,
  ): Promise<CustomerSummaryResponseDto> {
    assertCustomerAccess(customerId, currentUser);

    const customer = await this.customersRepository.findById(tenantId, customerId);
    if (!customer) {
      throw new NotFoundException('Cliente no encontrado.');
    }

    const [profile, contactMethods] = await Promise.all([
      this.customersRepository.findCurrentProfile(tenantId, customerId),
      this.customersRepository.findContactMethods(tenantId, customerId),
    ]);

    return toCustomerSummaryResponse({ customer, profile, contactMethods });
  }
}
