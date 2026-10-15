/**
 * @file Servicio de aplicación o dominio: arma el expediente de investigación de un cliente.
 * @business Permite a quien investiga ver, en un solo resumen, el perfil, los contactos, el riesgo, los casos y la identidad del cliente.
 * @system compone lecturas de clientes, riesgo, revisión manual, fraude y agenda en un único resumen.
 */
import { Injectable, NotFoundException } from '@nestjs/common';
import { CustomerContactsSnapshotService } from '../customer-onboarding/application/customer-contacts-snapshot.service.js';
import { CustomersRepository } from '../customers/customers.repository.js';
import { CustomerContactsRepository } from '../customers/repositories/customer-contacts.repository.js';
import { RiskAssessmentRepository } from '../risk/repositories/risk-assessment.repository.js';
import { CustomerInvestigationRepository } from './customer-investigation.repository.js';
import { InvestigationSummaryResponseDto } from './operations.dtos.js';
import { toInvestigationSummaryResponse } from './operations.mapper.js';
import { ManualReviewCaseRepository } from './manual-review-case.repository.js';
import { OperationsCustomerIdParamsDto } from './operations.schemas.js';

@Injectable()
export class OperationsInvestigationService {
  constructor(
    private readonly customersRepository: CustomersRepository,
    private readonly customerContactsRepository: CustomerContactsRepository,
    private readonly riskAssessmentRepository: RiskAssessmentRepository,
    private readonly manualReviews: ManualReviewCaseRepository,
    private readonly investigation: CustomerInvestigationRepository,
    /*
     * La agenda del cliente la calcula y la guarda el módulo de ALTA, y de ahí se
     * lee. No se duplica la consulta aquí porque entonces habría dos definiciones
     * de qué significa «la agenda de este cliente» —una para decidir y otra para
     * investigar— y basta con que se separen una vez para que el analista vea unos
     * números y el motor decida con otros.
     */
    private readonly contactsSnapshot: CustomerContactsSnapshotService,
  ) {}

  async getInvestigationSummary(tenantId: string, params: OperationsCustomerIdParamsDto): Promise<InvestigationSummaryResponseDto> {
    const customer = await this.customersRepository.findById(tenantId, params.customerId);
    if (!customer) {
      throw new NotFoundException('Cliente no encontrado.');
    }

    const [profile, contacts, consents, latestRiskResult, manualReviewCases, fraudCases, latestIdentityAttempt, addressBook] =
      await Promise.all([
        this.customersRepository.findCurrentProfile(tenantId, params.customerId),
        this.customerContactsRepository.findContactMethods(tenantId, params.customerId),
        this.customersRepository.findCustomerConsents(tenantId, params.customerId),
        this.riskAssessmentRepository.findLatestCustomerRiskResult(tenantId, params.customerId),
        this.manualReviews.findOpenManualReviewCasesForCustomer(tenantId, params.customerId),
        this.investigation.findFraudCasesForCustomer(tenantId, params.customerId),
        this.investigation.findLatestIdentityAttempt(tenantId, params.customerId),
        // La agenda es una lectura auxiliar: si falla, el expediente entero no puede
        // dejar de verse por ella. Degradar a «no disponible» es lo mismo que la
        // pantalla enseña cuando la persona no dio el permiso.
        this.contactsSnapshot.featuresFor(tenantId, params.customerId).catch(() => ({
          available: false,
          totalContacts: 0,
          uniqueRatio: 0,
          bolivianRatio: 0,
          referencesFoundInAddressBook: 0,
          riskMatches: 0,
        })),
      ]);

    return toInvestigationSummaryResponse({
      customer,
      profile,
      contacts,
      consents,
      latestRiskResult,
      manualReviewCases,
      fraudCases,
      latestIdentityAttempt,
      addressBook,
    });
  }
}
