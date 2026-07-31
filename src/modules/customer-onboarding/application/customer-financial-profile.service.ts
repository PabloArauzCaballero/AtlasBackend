/**
 * @file Servicio de aplicación o dominio: ejecuta reglas y coordina dependencias.
 * @business Esta pieza convierte un registro inicial en un cliente verificable, conforme y listo para evaluación financiera.
 * @system orquesta perfil, contactos, identidad, documentos, dirección, referencias, screening y estado del flujo.
 */
import { Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { InjectConnection } from '@nestjs/sequelize';
import { Sequelize } from 'sequelize-typescript';
import { Transaction } from 'sequelize';
import { AuthenticatedUser } from '../../../common/types/auth.types.js';
import { assertOwnCustomerResourceOrInternalOperational } from '../../../common/utils/auth/ownership.util.js';
import { CustomerLifecycleService } from '../../customers/application/customer-lifecycle.service.js';
import { FINANCIAL_ATTRIBUTE_CODES, FinancialAttributeCode } from '../../customers/customer-eligibility.constants.js';
import { EDITABLE_ONBOARDING_STATUSES, normalizeLifecycleStatus } from '../../customers/customer-lifecycle.constants.js';
import { CustomersRepository } from '../../customers/customers.repository.js';
import { FinancialProfileDto } from '../customer-onboarding-profile.schemas.js';
import { CustomerOnboardingRepository } from '../customer-onboarding.repository.js';
import { CustomerProfileDataRepository } from '../repositories/customer-profile-data.repository.js';

/** Traducción entre el contrato HTTP (camelCase) y el `attribute_code` del catálogo (snake_case). */
const FIELD_TO_ATTRIBUTE_CODE: Readonly<Record<keyof FinancialProfileDto, FinancialAttributeCode>> = {
  employmentStatus: 'employment_status',
  employerName: 'employer_name',
  employmentSeniorityMonths: 'employment_seniority_months',
  monthlyIncomeDeclared: 'monthly_income_declared',
  otherMonthlyIncome: 'other_monthly_income',
  monthlyExpensesDeclared: 'monthly_expenses_declared',
  economicActivityCode: 'economic_activity_code',
  sourceOfFunds: 'source_of_funds',
};

type AttributeWrite = { code: FinancialAttributeCode; valueText: string | null; valueNumber: string | null };

function toAttributeWrites(body: FinancialProfileDto): AttributeWrite[] {
  const writes: AttributeWrite[] = [];
  for (const [field, value] of Object.entries(body)) {
    if (value === undefined) continue;
    const code = FIELD_TO_ATTRIBUTE_CODE[field as keyof FinancialProfileDto];
    if (!code) continue;
    writes.push(
      typeof value === 'number'
        ? { code, valueText: null, valueNumber: value.toFixed(4) }
        : { code, valueText: String(value), valueNumber: null },
    );
  }
  return writes;
}

/**
 * Perfil laboral, económico y financiero (N3).
 *
 * Se persiste sobre `customer_attribute_values` + `attribute_definitions`, dos tablas que estaban
 * migradas desde el arranque del proyecto y no tenían ni un solo uso en el código. Se reutilizan en
 * vez de agregar columnas a `customers` porque el modelo EAV versionado que ya definen es
 * exactamente lo que este dominio necesita: historial por valor (`valid_from`/`valid_until`), origen
 * (`source_type`) y distinción entre lo declarado y lo verificado (`verification_status`).
 *
 * Igual que el perfil personal, acepta escrituras parciales: es la base del autoguardado por sección.
 */
@Injectable()
export class CustomerFinancialProfileService {
  constructor(
    private readonly customersRepository: CustomersRepository,
    private readonly profileDataRepository: CustomerProfileDataRepository,
    private readonly onboardingRepository: CustomerOnboardingRepository,
    private readonly lifecycleService: CustomerLifecycleService,
    @InjectConnection() private readonly sequelize: Sequelize,
  ) {}

  async upsertFinancialProfile(input: {
    tenantId: string;
    customerId: string;
    body: FinancialProfileDto;
    currentUser: AuthenticatedUser;
    ipAddress: string | null;
  }) {
    assertOwnCustomerResourceOrInternalOperational(input.currentUser, input.customerId);

    const customer = await this.customersRepository.findById(input.tenantId, input.customerId);
    if (!customer) throw new NotFoundException('Cliente no encontrado.');

    const status = normalizeLifecycleStatus(customer.lifecycleStatus);
    if (!EDITABLE_ONBOARDING_STATUSES.includes(status)) {
      throw new UnprocessableEntityException(`PROFILE_NOT_EDITABLE_IN_STATUS: ${status}`);
    }

    const writes = toAttributeWrites(input.body);
    const definitions = await this.profileDataRepository.findAttributeDefinitionsByCode(FINANCIAL_ATTRIBUTE_CODES);
    const definitionByCode = new Map(definitions.map((row) => [row.attributeCode ?? '', String(row.id)]));

    // Falla explícitamente si el catálogo no está sembrado: guardar en silencio la mitad de los
    // campos dejaría al cliente creyendo que completó una sección que la regla verá vacía.
    const missingDefinitions = writes.filter((write) => !definitionByCode.has(write.code)).map((write) => write.code);
    if (missingDefinitions.length > 0) {
      throw new UnprocessableEntityException(`ATTRIBUTE_CATALOG_NOT_SEEDED: ${missingDefinitions.join(', ')}`);
    }

    const now = new Date();

    return this.sequelize.transaction(async (transaction) => {
      const written = await this.writeAttributes({
        tenantId: input.tenantId,
        customerId: input.customerId,
        writes,
        definitionByCode,
        now,
        transaction,
      });

      const flow = await this.onboardingRepository.findLatestOnboardingFlow(input.tenantId, input.customerId, { transaction });
      await this.onboardingRepository.createOnboardingStepEvent(
        {
          tenantId: input.tenantId,
          onboardingFlowId: flow ? String(flow.id) : null,
          stepCode: 'financial_profile_updated',
          eventType: 'completed',
          happenedAt: now,
          payloadJson: { attributeCodes: written },
        },
        { transaction },
      );

      await this.lifecycleService.advance({
        tenantId: input.tenantId,
        customerId: input.customerId,
        toStatus: 'onboarding_in_progress',
        reasonCode: 'financial_profile_updated',
        changedByType: input.currentUser.role,
        changedByInternalUserId: input.currentUser.internalUserId ?? null,
        notes: 'Perfil económico actualizado por el cliente.',
        transaction,
      });

      await this.onboardingRepository.createOperationalAuditLog(
        {
          tenantId: input.tenantId,
          actorType: input.currentUser.role,
          actorInternalUserId: input.currentUser.internalUserId ?? null,
          actionCode: 'customer_onboarding.financial_profile_updated',
          targetType: 'customer',
          targetId: input.customerId,
          ipAddress: input.ipAddress,
          userAgent: null,
          // Solo los CÓDIGOS de atributo, nunca los valores: ingresos y empleador son PII económica
          // y esta tabla es de auditoría, no de negocio.
          payloadJson: { attributeCodes: written },
          occurredAt: now,
        },
        { transaction },
      );

      return { customerId: input.customerId, updatedAttributes: written, updatedAt: now.toISOString() };
    });
  }

  /** Cierra la vigencia del valor anterior e inserta el nuevo. La tabla es append-only. */
  private async writeAttributes(context: {
    tenantId: string;
    customerId: string;
    writes: AttributeWrite[];
    definitionByCode: Map<string, string>;
    now: Date;
    transaction: Transaction;
  }): Promise<string[]> {
    const definitionIds = context.writes.map((write) => context.definitionByCode.get(write.code) ?? '');
    const current = await this.profileDataRepository.findCurrentAttributeValues(context.tenantId, context.customerId, definitionIds, {
      transaction: context.transaction,
    });
    const currentByDefinition = new Map(current.map((row) => [String(row.attributeDefinitionId), row]));

    const written: string[] = [];
    for (const write of context.writes) {
      const definitionId = context.definitionByCode.get(write.code);
      if (!definitionId) continue;

      const previous = currentByDefinition.get(definitionId);
      if (previous) {
        await this.profileDataRepository.closeAttributeValue(previous, context.now, { transaction: context.transaction });
      }

      await this.profileDataRepository.createAttributeValue(
        {
          tenantId: context.tenantId,
          customerId: context.customerId,
          attributeDefinitionId: definitionId,
          valueText: write.valueText,
          valueNumber: write.valueNumber,
          valueBoolean: null,
          valueJson: null,
          sourceType: 'customer_declared',
          verificationStatus: 'declared',
          validFrom: context.now,
        },
        { transaction: context.transaction },
      );
      written.push(write.code);
    }
    return written;
  }
}
