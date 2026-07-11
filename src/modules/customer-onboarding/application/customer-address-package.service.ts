import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectConnection } from '@nestjs/sequelize';
import { Sequelize } from 'sequelize-typescript';
import { AuthenticatedUser } from '../../../common/types/auth.types.js';
import { assertOwnCustomerResourceOrInternalOperational } from '../../../common/utils/auth/ownership.util.js';
import { sha256Hex } from '../../../common/utils/crypto/hash.util.js';
import { CustomersRepository } from '../../customers/customers.repository.js';
import { CustomerOnboardingRepository } from '../customer-onboarding.repository.js';
import { AddressPackageDto } from '../customer-onboarding.schemas.js';

@Injectable()
export class CustomerAddressPackageService {
  constructor(
    private readonly customersRepository: CustomersRepository,
    private readonly onboardingRepository: CustomerOnboardingRepository,
    @InjectConnection() private readonly sequelize: Sequelize,
  ) {}

  async submitAddressPackage(input: {
    tenantId: string;
    customerId: string;
    body: AddressPackageDto;
    currentUser: AuthenticatedUser;
    ipAddress: string | null;
    idempotencyKey: string;
  }) {
    if (!input.idempotencyKey) throw new BadRequestException('X-Idempotency-Key header is required.');
    assertOwnCustomerResourceOrInternalOperational(input.currentUser, input.customerId);
    const customer = await this.customersRepository.findById(input.tenantId, input.customerId);
    if (!customer) throw new NotFoundException('Cliente no encontrado.');

    const now = new Date();
    return this.sequelize.transaction(async (transaction) => {
      let address = await this.onboardingRepository.findCurrentAddress(input.tenantId, input.customerId, 'home', { transaction });
      if (!address) {
        address = await this.onboardingRepository.createAddress(
          { tenantId: input.tenantId, customerId: input.customerId, addressType: 'home', now },
          { transaction },
        );
      } else {
        await this.onboardingRepository.touchAddress(address, now, { transaction });
      }

      const declaredAddressText = input.body.address.addressLineEncrypted ?? null;
      // `addressLineEncrypted` llega ya cifrado/opaco del cliente (envelope-encryption todavía no
      // está conectado a customer-onboarding — ver ATLAS-AUDIT-012), así que esta capa no puede
      // leer el texto real para normalizarlo (mayúsculas, tildes, abreviaturas). Lo que se guarda
      // en `normalized_address_text` es una huella (fingerprint) del valor declarado, útil para
      // detectar duplicados/cambios entre versiones sin tocar el contenido — NO texto humano
      // normalizado, a pesar de lo que sugiere el nombre de la columna y del dato de ejemplo en
      // el seeder de demo (`20260706000000-seed-deep-graph-demo-data.ts`, que sí usa texto plano
      // legible solo porque es data de demostración, no un caso real).
      const normalizedAddressText = declaredAddressText ? sha256Hex(declaredAddressText) : null;
      const version = await this.onboardingRepository.createAddressVersion(
        {
          tenantId: input.tenantId,
          customerAddressId: String(address.id),
          declaredAddressText,
          normalizedAddressText,
          zone: input.body.address.zone ?? null,
          city: input.body.address.city,
          department: input.body.address.department,
          countryCode: input.body.address.countryCode,
          sourceType: 'customer_onboarding',
          validFrom: now,
        },
        { transaction },
      );
      await this.onboardingRepository.updateAddressCurrentVersion(address, String(version.id), now, { transaction });

      if (input.body.gpsObservation) {
        const gps = input.body.gpsObservation;
        await this.onboardingRepository.createGpsObservation(
          {
            tenantId: input.tenantId,
            customerId: input.customerId,
            customerAddressId: String(address.id),
            addressVersionId: String(version.id),
            sessionId: input.body.sessionId ?? null,
            gpsLat: gps.lat.toFixed(7),
            gpsLng: gps.lng.toFixed(7),
            gpsAccuracyMeters: gps.accuracyMeters ? gps.accuracyMeters.toFixed(2) : null,
            capturedAt: gps.capturedAt ? new Date(gps.capturedAt) : now,
          },
          { transaction },
        );
        await this.onboardingRepository.createCustomerObservation(
          {
            tenantId: input.tenantId,
            customerId: input.customerId,
            sessionId: input.body.sessionId ?? null,
            deviceId: null,
            observationCode: 'gps_address_observed',
            valueText: null,
            valueNumber: gps.accuracyMeters ? gps.accuracyMeters.toFixed(2) : null,
            valueBoolean: null,
            valueJson: { hasGps: true, accuracyMeters: gps.accuracyMeters ?? null },
            confidenceScore: null,
            observedAt: gps.capturedAt ? new Date(gps.capturedAt) : now,
          },
          { transaction },
        );
      }

      const flow = await this.onboardingRepository.findLatestOnboardingFlow(input.tenantId, input.customerId, { transaction });
      await this.onboardingRepository.createOnboardingStepEvent(
        {
          tenantId: input.tenantId,
          onboardingFlowId: flow ? String(flow.id) : null,
          stepCode: 'address_package_submitted',
          eventType: 'completed',
          happenedAt: now,
          payloadJson: { addressId: String(address.id), addressVersionId: String(version.id) },
        },
        { transaction },
      );
      await this.onboardingRepository.createCustomerActionLog(
        {
          tenantId: input.tenantId,
          customerId: input.customerId,
          sessionId: input.body.sessionId ?? null,
          deviceId: null,
          eventName: 'address_package_submitted',
          screenName: 'address_capture',
          payloadJson: { idempotencyKeyHash: sha256Hex(input.idempotencyKey), hasGps: input.body.gpsObservation !== undefined },
          occurredAt: now,
        },
        { transaction },
      );
      await this.onboardingRepository.createOperationalAuditLog(
        {
          tenantId: input.tenantId,
          actorType: input.currentUser.role,
          actorInternalUserId: input.currentUser.internalUserId ?? null,
          actionCode: 'customer_onboarding.address_package',
          targetType: 'customer',
          targetId: input.customerId,
          ipAddress: input.ipAddress,
          userAgent: null,
          payloadJson: { addressId: String(address.id), addressVersionId: String(version.id) },
          occurredAt: now,
        },
        { transaction },
      );

      return {
        customerId: input.customerId,
        addressId: String(address.id),
        addressVersionId: String(version.id),
        status: 'recorded',
        nextStep: 'risk_evaluation',
      };
    });
  }
}
