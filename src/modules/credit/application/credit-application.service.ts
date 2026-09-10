/**
 * @file Servicio de aplicación o dominio: ejecuta reglas y coordina dependencias.
 * @business Esta pieza materializa la oferta y solicitud de crédito solo para clientes habilitados y con decisiones explicables.
 * @system coordina productos, solicitudes, transiciones y eventos inmutables del ciclo de crédito.
 */
import { Injectable } from '@nestjs/common';
import { InjectConnection } from '@nestjs/sequelize';
import { Sequelize } from 'sequelize-typescript';

import { AuthenticatedUser } from '../../../common/types/auth.types.js';
import { assertOwnCustomerResourceOrInternalOperational } from '../../../common/utils/auth/ownership.util.js';

import { CustomerEligibilityService } from '../../customers/application/customer-eligibility.service.js';
import { CustomerEligibilityRepository } from '../../customers/repositories/customer-eligibility.repository.js';
import { PartnerDirectoryService } from '../../partner-onboarding/application/partner-directory.service.js';
import { PartnerProfileService } from '../../partner-onboarding/application/partner-profile.service.js';

import { CreditUnderwritingService } from './credit-underwriting.service.js';
import { CreateCreditApplicationDto } from '../credit.schemas.js';
import { CreditRepository } from '../credit.repository.js';

/**
 * Creación de la solicitud de crédito.
 *
 * Es el punto donde toda la cadena anterior tiene que sostenerse. La regla que lo gobierna es
 * simple y no negociable: **la elegibilidad se vuelve a evaluar aquí, en el servidor, antes de
 * escribir nada**. Que el frontend oculte el botón "Solicitar crédito" es experiencia de usuario; la
 * garantía es esta reevaluación, porque un cliente puede quedar inelegible entre que se pintó la
 * pantalla y que llegó el request —un caso de fraude abierto, un consentimiento revocado, un
 * documento vencido— y porque nada impide llamar al endpoint directamente.
 *
 * La evaluación que autoriza la solicitud se guarda junto a ella: `eligibility_evaluation_id` apunta
 * a la fila concreta y `eligibility_snapshot_json` congela su resultado.
 */
import { CreditApplicationAdmissionService } from './credit-application-admission.service.js';

@Injectable()
export class CreditApplicationService {
  constructor(
    private readonly creditRepository: CreditRepository,
    private readonly eligibilityService: CustomerEligibilityService,
    private readonly eligibilityRepository: CustomerEligibilityRepository,
    private readonly underwriting: CreditUnderwritingService,
    private readonly partnerProfiles: PartnerProfileService,
    private readonly partnerDirectory: PartnerDirectoryService,
    @InjectConnection() private readonly sequelize: Sequelize,
    private readonly admision: CreditApplicationAdmissionService,
  ) {}

  async createApplication(input: {
    tenantId: string;
    customerId: string;
    body: CreateCreditApplicationDto;
    currentUser: AuthenticatedUser;
    idempotencyKey: string;
  }) {
    assertOwnCustomerResourceOrInternalOperational(input.currentUser, input.customerId);

    const created = await this.admision.persistApplication(input);

    // El motor se consulta DESPUÉS de confirmar la transacción: es E/S de red, y sostenerla dentro
    // dejaría una transacción abierta durante la respuesta de un sistema ajeno. Un producto marcado
    // para revisión manual no se automatiza — esa marca es una decisión de negocio, no un defecto.
    if (created.status !== 'submitted') return created;

    const decided = await this.underwriting.underwrite({
      tenantId: input.tenantId,
      applicationId: created.applicationId,
      customerId: input.customerId,
      applicationCode: created.applicationCode,
      requestedAmount: created.requestedAmount,
      requestedTermMonths: created.requestedTermMonths,
      currencyCode: created.currencyCode,
      productCode: created.productCode,
      purposeCode: created.purposeCode,
    });

    return { ...created, status: decided.status, decisionMode: decided.decisionMode, executionId: decided.executionId };
  }

  async listApplications(input: { tenantId: string; customerId: string; currentUser: AuthenticatedUser }) {
    assertOwnCustomerResourceOrInternalOperational(input.currentUser, input.customerId);
    const applications = await this.creditRepository.findApplicationsByCustomer(input.tenantId, input.customerId);
    return {
      customerId: input.customerId,
      applications: applications.map((application) => ({
        applicationId: String(application.id),
        applicationCode: application.applicationCode,
        status: application.status,
        requestedAmount: application.requestedAmount,
        requestedTermMonths: application.requestedTermMonths,
        currencyCode: application.currencyCode,
        submittedAt: application.submittedAt.toISOString(),
        decidedAt: application.decidedAt?.toISOString() ?? null,
        // `decision_reason_code` sí se expone: el cliente tiene derecho a saber por qué.
        decisionReasonCode: application.decisionReasonCode,
        /*
         * Si el comercio ya respondió a la operación que el motor aprobó.
         *
         * El cliente NO puede pagar el inicial hasta que el negocio acepta la venta: el motor dice
         * «este solicitante cumple», pero es el comercio el que confirma «sí, quiero esta venta
         * ahora». Sin este dato, la app no tenía forma de distinguir «aprobado, esperando al
         * comercio» de «aprobado y listo para pagar», y habilitaba el pago antes de tiempo.
         *
         * `null` cuando no aplica —una renovación sin comercio, o una aprobación firmada por una
         * persona, que ya lleva dentro la decisión del negocio—.
         */
        businessAcceptance: application.businessAcceptance,
        businessAcceptanceAt: application.businessAcceptanceAt?.toISOString() ?? null,
      })),
    };
  }
}
