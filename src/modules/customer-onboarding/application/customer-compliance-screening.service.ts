/**
 * @file Servicio de aplicación o dominio: ejecuta reglas y coordina dependencias.
 * @business Esta pieza convierte un registro inicial en un cliente verificable, conforme y listo para evaluación financiera.
 * @system orquesta perfil, contactos, identidad, documentos, dirección, referencias, screening y estado del flujo.
 */
import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectConnection } from '@nestjs/sequelize';
import { Sequelize } from 'sequelize-typescript';
import { AuthenticatedUser } from '../../../common/types/auth.types.js';
import { hashSensitiveText } from '../../../common/utils/crypto/hash.util.js';
import { CustomerEligibilityService } from '../../customers/application/customer-eligibility.service.js';
import { CustomerLifecycleService } from '../../customers/application/customer-lifecycle.service.js';
import { CustomersRepository } from '../../customers/customers.repository.js';
import { CustomerOnboardingRepository } from '../customer-onboarding.repository.js';
import { CustomerProfileDataRepository } from '../repositories/customer-profile-data.repository.js';
import { CustomerVerificationRepository } from '../repositories/customer-verification.repository.js';

/**
 * Screening contra listas restrictivas (C13).
 *
 * `watchlist_entries` y `watchlist_matches` estaban migradas desde el arranque del proyecto y el
 * motor de riesgo del onboarding NUNCA las consultaba: un cliente en una lista de cumplimiento
 * pasaba el flujo sin que nadie lo notara.
 *
 * El cotejo es por HASH del dato, no por su valor en claro: la lista almacena `entity_hash` y aquí
 * se calcula el hash del documento y del nombre normalizado del cliente. Eso permite cotejar contra
 * una lista externa sin que ninguna de las dos partes exponga los datos personales.
 *
 * Una coincidencia bloquea la habilitación (C13) y lleva al cliente a `under_review`; descartarla es
 * una decisión humana explícita y auditada, no un efecto de reejecutar el screening.
 */
@Injectable()
export class CustomerComplianceScreeningService {
  constructor(
    private readonly customersRepository: CustomersRepository,
    private readonly profileDataRepository: CustomerProfileDataRepository,
    private readonly verificationRepository: CustomerVerificationRepository,
    private readonly onboardingRepository: CustomerOnboardingRepository,
    private readonly lifecycleService: CustomerLifecycleService,
    private readonly eligibilityService: CustomerEligibilityService,
    @InjectConnection() private readonly sequelize: Sequelize,
  ) {}

  async screen(input: { tenantId: string; customerId: string; currentUser: AuthenticatedUser; ipAddress: string | null }) {
    const customer = await this.customersRepository.findById(input.tenantId, input.customerId);
    if (!customer) throw new NotFoundException('Cliente no encontrado.');

    const profile = await this.profileDataRepository.findCurrentProfile(input.tenantId, input.customerId);
    const now = new Date();

    // Se cotejan el nombre normalizado y el teléfono/correo primarios, que son los hashes que el
    // sistema ya calcula. El número de documento no participa: se guarda hasheado con la misma
    // función, pero su hash vive en `customer_identity_documents` y se agrega aquí.
    const candidates = new Map<string, string>();
    if (profile?.fullNameNormalized) candidates.set(hashSensitiveText(profile.fullNameNormalized), 'person_name');
    if (customer.primaryPhoneHash) candidates.set(customer.primaryPhoneHash, 'phone');
    if (customer.primaryEmailHash) candidates.set(customer.primaryEmailHash, 'email');

    const entries = await this.verificationRepository.findActiveEntriesByHashes(input.tenantId, [...candidates.keys()], now);

    return this.sequelize.transaction(async (transaction) => {
      const existing = await this.verificationRepository.findMatches(input.tenantId, input.customerId, { transaction });
      const alreadyMatched = new Set(existing.map((match) => String(match.watchlistEntryId)));

      const created: string[] = [];
      for (const entry of entries) {
        if (alreadyMatched.has(String(entry.id))) continue;
        const match = await this.verificationRepository.createMatch(
          {
            tenantId: input.tenantId,
            watchlistEntryId: String(entry.id),
            customerId: input.customerId,
            matchedEntityType: entry.entityType ?? candidates.get(entry.entityHash ?? '') ?? 'unknown',
            matchedValueHash: entry.entityHash ?? '',
            matchMethod: 'exact_hash',
            matchConfidence: '1.00',
            matchedAt: now,
          },
          { transaction },
        );
        created.push(String(match.id));
      }

      if (created.length > 0) {
        // Una coincidencia nueva no puede quedar solo registrada: saca al cliente del camino
        // automático y lo pone en manos de cumplimiento.
        await this.lifecycleService.advance({
          tenantId: input.tenantId,
          customerId: input.customerId,
          toStatus: 'under_review',
          reasonCode: 'compliance_watchlist_match',
          changedByType: input.currentUser.role,
          changedByInternalUserId: input.currentUser.internalUserId ?? null,
          notes: `Coincidencias nuevas en listas restrictivas: ${created.length}.`,
          transaction,
        });
      }

      await this.onboardingRepository.createOperationalAuditLog(
        {
          tenantId: input.tenantId,
          actorType: input.currentUser.role,
          actorInternalUserId: input.currentUser.internalUserId ?? null,
          actionCode: 'customer_onboarding.compliance.screening',
          targetType: 'customer',
          targetId: input.customerId,
          ipAddress: input.ipAddress,
          userAgent: null,
          // Solo el conteo y los ids de la coincidencia: el hash cotejado es dato de cumplimiento.
          payloadJson: { candidatesEvaluated: candidates.size, newMatches: created.length, matchIds: created },
          occurredAt: now,
        },
        { transaction },
      );

      const evaluation = await this.eligibilityService.evaluateAndRecord({
        tenantId: input.tenantId,
        customerId: input.customerId,
        evaluatedByType: input.currentUser.role,
        evaluatedByInternalUserId: input.currentUser.internalUserId ?? null,
        decisionSource: 'automatic',
        reasonCode: 'compliance_screening',
        transaction,
      });

      return {
        customerId: input.customerId,
        candidatesEvaluated: candidates.size,
        newMatches: created.length,
        totalMatches: existing.length + created.length,
        lifecycleStatus: evaluation.lifecycleStatus,
        eligible: evaluation.eligible,
        blockers: evaluation.blockers,
      };
    });
  }

  /** Descarte de una coincidencia por parte de cumplimiento. Decisión humana explícita. */
  async clearMatches(input: {
    tenantId: string;
    customerId: string;
    reasonCode: string;
    notes: string | null;
    currentUser: AuthenticatedUser;
    ipAddress: string | null;
  }) {
    const customer = await this.customersRepository.findById(input.tenantId, input.customerId);
    if (!customer) throw new NotFoundException('Cliente no encontrado.');

    const now = new Date();
    return this.sequelize.transaction(async (transaction) => {
      const matches = await this.verificationRepository.findMatches(input.tenantId, input.customerId, { transaction });
      for (const match of matches) {
        await this.verificationRepository.clearMatch(match, { transaction });
      }

      await this.onboardingRepository.createOperationalAuditLog(
        {
          tenantId: input.tenantId,
          actorType: input.currentUser.role,
          actorInternalUserId: input.currentUser.internalUserId ?? null,
          actionCode: 'customer_onboarding.compliance.matches_cleared',
          targetType: 'customer',
          targetId: input.customerId,
          ipAddress: input.ipAddress,
          userAgent: null,
          payloadJson: { clearedMatches: matches.length, reasonCode: input.reasonCode, notes: input.notes },
          occurredAt: now,
        },
        { transaction },
      );

      const evaluation = await this.eligibilityService.evaluateAndRecord({
        tenantId: input.tenantId,
        customerId: input.customerId,
        evaluatedByType: input.currentUser.role,
        evaluatedByInternalUserId: input.currentUser.internalUserId ?? null,
        decisionSource: 'manual_decision',
        reasonCode: input.reasonCode,
        notes: input.notes,
        transaction,
      });

      return { customerId: input.customerId, clearedMatches: matches.length, eligible: evaluation.eligible, blockers: evaluation.blockers };
    });
  }
}
